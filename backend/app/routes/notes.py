import re
import uuid
from datetime import datetime

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models import AudioFile, Note, NoteAddendum, Participant, Template, User
from app.services import audio_storage, note_export, note_search
from app.services import settings as settings_service
from app.services.audit import diff_fields, log_action

# Cap server-side search input. Long queries are almost always paste accidents
# and will just slow FTS down; the UI debounces at ~250ms so this is a hard
# upper bound, not a UX limit.
SEARCH_QUERY_MAX_LEN = 200
SEARCH_RESULT_LIMIT = 50

# Matches Note.name's SQLAlchemy column length. Kept here so request handlers
# can pre-clip user input rather than letting the DB driver raise.
NOTE_NAME_MAX_LEN = 120


def _clean_name(raw) -> str | None:
    """Normalize an incoming `name` field: trim, clip, treat blank as None.

    Returning None (rather than empty string) keeps the DB column null when
    the user clears the field, which is what the table view's fallback
    rendering keys off of.
    """
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    return s[:NOTE_NAME_MAX_LEN]


def _clean_speaker_labels(raw, segments, author_id):
    """Validate an incoming speakerLabels map against a note's diarized segments.

    Returns a normalized dict, or None when there's nothing usable. Keys that
    don't appear in `segments` are dropped (guards against stale labels after
    a re-transcribe); entries with a blank name are dropped (an unset dropdown
    falls back to the raw "Speaker N"). A participantId is kept only when it
    resolves to a contact owned by `author_id` — otherwise the entry survives
    as a free-text name with participantId=None.
    """
    if not isinstance(raw, dict):
        return None
    valid_speakers = {
        s['speaker'] for s in (segments or []) if isinstance(s, dict) and 'speaker' in s
    }
    cleaned = {}
    for speaker, val in raw.items():
        if speaker not in valid_speakers or not isinstance(val, dict):
            continue
        name = val.get('name')
        name = name.strip() if isinstance(name, str) else ''
        if not name:
            continue
        pid = val.get('participantId')
        if pid is not None:
            if not Participant.query.filter_by(id=pid, author_id=author_id).first():
                pid = None
        cleaned[speaker] = {"participantId": pid, "name": name[:NOTE_NAME_MAX_LEN]}
    return cleaned or None


bp = Blueprint("notes", __name__, url_prefix="/api/notes")


@bp.route('', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def create_note():
    data = request.get_json(silent=True) or {}
    print('creating note', data)

    note_date = datetime.utcnow()
    if 'noteDate' in data:
        note_date = datetime.fromisoformat(data['noteDate'].replace("Z", ""))

    if not all(k in data for k in (
        'noteContentRaw',
        'noteContentMarkdown',
        'authorName',
        'noteDate',
    )):
        print('missing required fields', data)
        return jsonify({"error": "Missing required fields"}), 400

    current_user = get_jwt_identity()

    # Empty/missing noteTemplate is allowed — the note just stores the raw
    # transcript with no template association. Coerce '' to None so the FK
    # column doesn't receive a stringy empty value.
    template_id = data.get('noteTemplate') or None
    if template_id:
        # Must be the caller's own, non-trashed template. Without the
        # is_deleted / author_id filter a direct API call could attach a note
        # to a soft-deleted template (the dropdown already hides those) or to
        # someone else's template.
        template = Template.query.filter_by(
            id=template_id, author_id=current_user, is_deleted=False
        ).first()
        if not template:
            print('template not found / not available', template_id)
            return jsonify({"error": f"Template with ID {template_id} not found"}), 400

    if not isinstance(data['participants'], list):
        return jsonify({"error": "participants must be a list"}), 400

    try:
        for participant in data['participants']:
            if not isinstance(participant, dict):
                return jsonify({"error": "Each participant must be an object"}), 400
            if 'firstName' not in participant:
                return jsonify({"error": "Each participant must have a firstName"}), 400
    except Exception as e:
        participants = []
        print(f"Error accessing participants: {str(e)}")

    # Resolve transcript_group_id: re-transcribes inherit the source's group,
    # everything else gets a fresh UUID.
    source_note_id = data.get('sourceNoteId')
    if source_note_id:
        source_note = Note.query.filter_by(id=source_note_id, author_id=current_user).first()
        if not source_note:
            return jsonify({"error": "Source note not found"}), 404
        if not source_note.transcript_group_id:
            source_note.transcript_group_id = str(uuid.uuid4())
        transcript_group_id = source_note.transcript_group_id
    else:
        transcript_group_id = str(uuid.uuid4())

    # Link the encrypted audio uploaded during /api/transcribe to this
    # group. Three cases handled here:
    #   1. New recording: the orphan AudioFile (transcript_group_id=NULL)
    #      gets stamped with the new group and finalized_at.
    #   2. Re-transcribe of an existing note: the source group already has
    #      an audio row, so we just verify the client-provided id matches
    #      it and skip the stamp. A mismatched id is silently ignored —
    #      the user re-formatting a note shouldn't be able to replace its
    #      audio.
    #   3. No audio_file_id (legacy clients, or text-only): nothing to do.
    audio_file_id = data.get('audioFileId')
    if audio_file_id:
        audio_row = AudioFile.query.filter_by(
            id=audio_file_id, author_id=current_user
        ).first()
        if not audio_row:
            return jsonify({"error": "audioFileId not found"}), 400
        if audio_row.transcript_group_id is None:
            audio_row.transcript_group_id = transcript_group_id
            audio_row.finalized_at = datetime.utcnow()
        elif audio_row.transcript_group_id != transcript_group_id:
            # Already attached to a different group — refuse rather than
            # silently re-link, which would orphan the previous group's audio.
            return jsonify({"error": "audioFileId already linked to a different note"}), 409

    participants = []
    if 'participants' in data:
        for participant_data in data['participants']:
            if isinstance(participant_data, dict):
                if 'id' in participant_data:
                    existing_participant = Participant.query.get(participant_data['id'])
                    if existing_participant:
                        participants.append(existing_participant)
                        continue

                participant = Participant(
                    id=participant_data.get('id'),
                    first_name=participant_data.get('firstName', ''),
                    last_name=participant_data.get('lastName', ''),
                    email=participant_data.get('email', ''),
                )
                participants.append(participant)
            else:
                participants.append(participant_data)

    incoming_words = data.get('noteContentWords')
    print(
        f"[create_note] noteContentWords keys={list(data.keys())[:20]} "
        f"type={type(incoming_words).__name__} "
        f"len={len(incoming_words) if isinstance(incoming_words, list) else 'n/a'}"
    )
    new_note = Note(
        note_content_raw=data['noteContentRaw'],
        note_content_markdown=data['noteContentMarkdown'],
        note_content_segments=data.get('noteContentSegments'),
        # Usually None at creation — speakers are typically named later, once
        # the diarized transcript is reviewed — but accepted here for clients
        # that label inline before the first save.
        speaker_labels=_clean_speaker_labels(
            data.get('speakerLabels'), data.get('noteContentSegments'), current_user
        ),
        # Per-word Whisper probabilities flow in from the new-note flow's
        # transcription stream. Optional — older clients and pasted-text
        # notes won't supply it.
        note_content_words=incoming_words,
        note_type='text',
        note_date=note_date,
        name=_clean_name(data.get('name')),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        author_name=data['authorName'],
        version=data['version'],
        template_id=template_id,
        is_deleted=False,
        is_deleted_timestamp=None,
        transcript_group_id=transcript_group_id,
        participants=participants,
        author_id=current_user,
    )

    print('adding note', new_note)

    db.session.add(new_note)
    db.session.flush()

    log_action(
        'note.create',
        user_id=current_user,
        resource_type='note',
        resource_id=new_note.id,
        extra={
            'template_id': template_id,
            'transcript_group_id': transcript_group_id,
            'has_audio': bool(audio_file_id),
            'participant_count': len(participants),
            'note_type': new_note.note_type,
        },
    )
    db.session.commit()

    participants_response = [
        {
            "id": participant.id,
            "firstName": participant.first_name,
            "lastName": participant.last_name,
            "email": participant.email,
        }
        for participant in new_note.participants
    ]

    return jsonify({
        "id": new_note.id,
        "name": new_note.name,
        "createdAt": new_note.created_at,
        "updatedAt": new_note.updated_at,
        "noteContentRaw": new_note.note_content_raw,
        "noteContentMarkdown": new_note.note_content_markdown,
        "noteContentSegments": new_note.note_content_segments,
        "speakerLabels": new_note.speaker_labels,
        "noteContentWords": new_note.note_content_words,
        "approvedAt": new_note.approved_at,
        "status": new_note.status,
        "signedAt": new_note.signed_at,
        "participants": participants_response,
        "noteType": new_note.note_type,
        "authorId": new_note.author_id,
        "version": new_note.version,
    }), 201


@bp.route('/<string:id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_note(id):
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    print('getting note', note)
    log_action(
        'note.view',
        user_id=current_user,
        resource_type='note',
        resource_id=note.id,
    )
    db.session.commit()

    participants = []
    try:
        for participant in note.participants:
            participant_info = {
                "id": participant.id,
                "firstName": participant.first_name,
                "lastName": participant.last_name if hasattr(participant, 'last_name') else None,
                "email": participant.email if hasattr(participant, 'email') else None,
            }
            participants.append(participant_info)
    except Exception as e:
        print(f"Error accessing participants: {str(e)}")
        participants = []

    # Audio metadata so the frontend can render the player conditionally and
    # show file info without a separate round-trip. The actual bytes come
    # from GET /api/notes/<id>/audio.
    audio_row = None
    if note.transcript_group_id:
        audio_row = AudioFile.query.filter_by(
            author_id=current_user,
            transcript_group_id=note.transcript_group_id,
        ).first()

    return jsonify({
        "id": note.id,
        "name": note.name,
        "createdAt": note.created_at,
        "updatedAt": note.updated_at,
        "noteDate": note.note_date,
        "noteContentRaw": note.note_content_raw,
        "noteContentMarkdown": note.note_content_markdown,
        "noteContentSegments": note.note_content_segments,
        "speakerLabels": note.speaker_labels,
        "noteContentWords": note.note_content_words,
        "approvedAt": note.approved_at,
        "status": note.status,
        "signedAt": note.signed_at,
        "addenda": [_addendum_payload(a) for a in note.addenda],
        "authorId": note.author_id,
        "authorName": note.author_name,
        "noteType": note.note_type,
        "noteTemplate": note.template_id,
        "transcriptGroupId": note.transcript_group_id,
        "hasAudio": audio_row is not None,
        "audioMimeType": audio_row.mime_type if audio_row else None,
        "audioOriginalFilename": audio_row.original_filename if audio_row else None,
        "audioSizeBytes": audio_row.size_bytes if audio_row else None,
        "participants": participants,
        "version": note.version,
        "isDeleted": note.is_deleted,
        "isDeletedTimestamp": note.is_deleted_timestamp,
    })


@bp.route('/<string:id>/siblings', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_note_siblings(id):
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    if not note.transcript_group_id:
        return jsonify([]), 200

    siblings = (
        Note.query
        .filter_by(
            author_id=current_user,
            transcript_group_id=note.transcript_group_id,
            is_deleted=False,
        )
        .filter(Note.id != id)
        .all()
    )

    return jsonify([{
        "id": s.id,
        "noteDate": s.note_date,
        "noteTemplate": s.template_id,
        "createdAt": s.created_at,
        "updatedAt": s.updated_at,
    } for s in siblings])


@bp.route('/<string:id>/audio', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_note_audio(id):
    """Stream the decrypted source audio for a note.

    The audio is associated with the note's transcript_group_id, so all
    notes that share a recording resolve to the same file. 404 if the
    note has no group, no audio row exists for the group, or the on-disk
    file is missing.
    """
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404
    if not note.transcript_group_id:
        return jsonify({"error": "Note has no audio"}), 404

    audio_row = AudioFile.query.filter_by(
        author_id=current_user,
        transcript_group_id=note.transcript_group_id,
    ).first()
    if not audio_row or not audio_storage.file_exists(audio_row.stored_filename):
        return jsonify({"error": "Audio file not found"}), 404

    log_action(
        'note.audio_view',
        user_id=current_user,
        resource_type='note',
        resource_id=note.id,
        extra={'audio_file_id': audio_row.id},
    )
    db.session.commit()

    mime = audio_row.mime_type or 'application/octet-stream'
    # Quote the filename so commas/semicolons in user-supplied names don't
    # break the Content-Disposition header parser.
    safe_name = audio_row.original_filename.replace('"', '')
    headers = {
        'Content-Disposition': f'inline; filename="{safe_name}"',
        # Audio files are encrypted at rest with a per-install key, but the
        # decrypted stream we hand back to the browser is the original
        # plaintext — don't let intermediaries cache it.
        'Cache-Control': 'private, no-store',
    }

    @stream_with_context
    def generate():
        try:
            yield from audio_storage.open_decrypted_stream(audio_row.stored_filename)
        except Exception as e:
            # The browser has already received a 200 + headers by this point,
            # so we can't switch to a JSON error. Log and let the body end
            # short; the <audio> element will surface a decode error.
            print(f"audio decrypt failure for {audio_row.id}: {type(e).__name__}: {e}")

    return Response(generate(), mimetype=mime, headers=headers)


@bp.route('/<string:id>', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_note(id):
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    data = request.get_json(silent=True) or {}

    # Signed notes are immutable except the discovery `name` (a UI label,
    # not part of the record). The checks below are value-aware, not just
    # key-presence: the edit form always echoes the whole note back, so a
    # name-only save legitimately re-sends unchanged content. Only a real
    # diff on a locked field is rejected — post-sign changes go through
    # addenda. (Raw transcript edits are caught separately by the approved
    # check below; signing always sets approved_at.)
    if note.status == 'signed':
        signed_locked = (
            ('noteContentMarkdown' in data
             and data['noteContentMarkdown'] != note.note_content_markdown)
            or ('noteType' in data and data['noteType'] != note.note_type)
        )
        if not signed_locked and 'participants' in data and isinstance(data['participants'], list):
            incoming_ids = sorted(
                str(p.get('id')) for p in data['participants'] if isinstance(p, dict)
            )
            current_ids = sorted(str(p.id) for p in note.participants)
            signed_locked = incoming_ids != current_ids
        if signed_locked:
            return jsonify({
                "error": "This note is signed and locked. Add an addendum instead.",
            }), 409

    # Snapshot pre-edit values so we can record a diff in the audit log.
    # note_content_markdown can be many KB; record just "changed?" instead
    # of the full before/after to keep the log compact.
    before_markdown = note.note_content_markdown
    before_raw = note.note_content_raw
    before_note_type = note.note_type
    before_name = note.name
    before_participant_ids = sorted(p.id for p in note.participants)

    # Raw transcript is editable only while the note is in draft. Once the
    # user clicks Approve (approved_at is set) the raw is immutable forever.
    if 'noteContentRaw' in data and data['noteContentRaw'] != note.note_content_raw:
        if note.approved_at is not None:
            return jsonify({
                "error": "Raw transcript is locked because this note has been approved.",
            }), 409
        note.note_content_raw = data['noteContentRaw']

    # template_id is intentionally not updatable — a note is locked to its
    # original template. Re-recording with a different template should create
    # a new note instead.
    note.note_content_markdown = data.get('noteContentMarkdown', note.note_content_markdown)
    note.note_type = data.get('noteType', note.note_type)
    if 'name' in data:
        note.name = _clean_name(data.get('name'))
    note.updated_at = datetime.utcnow()
    note.version = note.version + 1

    if 'participants' in data and isinstance(data['participants'], list):
        note.participants.clear()

        for participant_data in data['participants']:
            if not isinstance(participant_data, dict) or 'id' not in participant_data or 'firstName' not in participant_data:
                return jsonify({"error": "Each participant must have an id and firstName"}), 400

            participant_id = participant_data['id']

            participant = Participant.query.get(participant_id)
            if participant:
                participant.first_name = participant_data['firstName']
                participant.last_name = participant_data.get('lastName', '')
                participant.email = participant_data.get('email', '')
            else:
                participant = Participant(
                    id=participant_id,
                    first_name=participant_data['firstName'],
                    last_name=participant_data.get('lastName', ''),
                    email=participant_data.get('email', ''),
                )
                db.session.add(participant)

            note.participants.append(participant)

    try:
        after_participant_ids = sorted(p.id for p in note.participants)
        diff = diff_fields(
            {
                'note_type': before_note_type,
                'name': before_name,
                'participant_ids': before_participant_ids,
            },
            {
                'note_type': note.note_type,
                'name': note.name,
                'participant_ids': after_participant_ids,
            },
        )
        if before_markdown != note.note_content_markdown:
            diff['note_content_markdown'] = {'changed': True}
        if before_raw != note.note_content_raw:
            diff['note_content_raw'] = {'changed': True}
        log_action(
            'note.update',
            user_id=current_user,
            resource_type='note',
            resource_id=note.id,
            extra={'changes': diff, 'new_version': note.version},
        )
        db.session.commit()
        db.session.refresh(note)

        participants = []
        for participant in note.participants:
            participant_info = {
                "id": participant.id,
                "firstName": participant.first_name,
                "lastName": participant.last_name,
                "email": participant.email,
            }
            participants.append(participant_info)

        return jsonify({
            "id": note.id,
            "name": note.name,
            "createdAt": note.created_at,
            "updatedAt": note.updated_at,
            "noteDate": note.note_date,
            "noteContentRaw": note.note_content_raw,
            "noteContentMarkdown": note.note_content_markdown,
            "noteContentSegments": note.note_content_segments,
            "noteContentWords": note.note_content_words,
            "approvedAt": note.approved_at,
            "status": note.status,
            "signedAt": note.signed_at,
            "addenda": [_addendum_payload(a) for a in note.addenda],
            "participants": participants,
            "noteType": note.note_type,
            "authorId": note.author_id,
            "authorName": note.author_name,
            "noteTemplate": note.template_id,
            "version": note.version,
            "isDeleted": note.is_deleted,
            "isDeletedTimestamp": note.is_deleted_timestamp,
        })

    except Exception as e:
        db.session.rollback()
        print(f"Error updating note: {str(e)}")
        return jsonify({"error": "Failed to update note"}), 500


@bp.route('/<string:id>/speakers', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_note_speakers(id):
    """Assign identities to the diarized speakers of a note.

    Speaker identification is part of transcript review, so the map is
    editable only while the raw transcript is — once the note is approved
    (approved_at set) it locks alongside the raw text. Kept separate from
    the main update endpoint: this is a labeling layer, not note content,
    so it doesn't bump `version` or round-trip the whole note.
    """
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    if note.approved_at is not None:
        return jsonify({
            "error": "Speaker labels are locked because this note has been approved.",
        }), 409

    data = request.get_json(silent=True) or {}
    if 'speakerLabels' in data and data['speakerLabels'] is not None \
            and not isinstance(data['speakerLabels'], dict):
        return jsonify({"error": "speakerLabels must be an object"}), 400

    note.speaker_labels = _clean_speaker_labels(
        data.get('speakerLabels'), note.note_content_segments, current_user
    )
    note.updated_at = datetime.utcnow()

    try:
        log_action(
            'note.update_speakers',
            user_id=current_user,
            resource_type='note',
            resource_id=note.id,
            extra={'speakers': sorted((note.speaker_labels or {}).keys())},
        )
        db.session.commit()
        return jsonify({"id": note.id, "speakerLabels": note.speaker_labels})
    except Exception as e:
        db.session.rollback()
        print(f"Error updating note speakers: {str(e)}")
        return jsonify({"error": "Failed to update speaker labels"}), 500


@bp.route('/<string:id>/approve', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def approve_note(id):
    """Lock the raw transcript. After this, the raw text is immutable —
    update_note rejects raw changes with 409. One-way for v1; no un-approve.
    Idempotent: approving an already-approved note returns the existing
    timestamp without re-stamping it.
    """
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user, is_deleted=False).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    if note.approved_at is None:
        note.approved_at = datetime.utcnow()
        log_action(
            'note.approve',
            user_id=current_user,
            resource_type='note',
            resource_id=note.id,
        )
        db.session.commit()

    return jsonify({"approvedAt": note.approved_at})


# Workflow states and the legal moves between them. draft<->finalized is
# reversible; finalized->signed is one-way. Signing is permanent — there is
# deliberately no transition out of 'signed'.
VALID_STATUSES = ('draft', 'finalized', 'signed')
_ALLOWED_STATUS_TRANSITIONS = {
    ('draft', 'finalized'),
    ('finalized', 'draft'),
    ('finalized', 'signed'),
}


def _status_payload(note: Note) -> dict:
    return {
        "id": note.id,
        "status": note.status,
        "signedAt": note.signed_at,
        "approvedAt": note.approved_at,
    }


@bp.route('/<string:id>/status', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_note_status(id):
    """Transition a note's workflow status.

    Body: {"status": "draft" | "finalized" | "signed"}.

    Legal moves: draft<->finalized, finalized->signed. Signing is permanent
    and also locks the raw transcript — it sets approved_at if unset, since
    signing implies approval. A no-op transition (status already == target)
    returns 200 so the client doesn't have to special-case it.
    """
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user, is_deleted=False).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    data = request.get_json(silent=True) or {}
    target = data.get('status')
    if target not in VALID_STATUSES:
        return jsonify({"error": f"status must be one of {list(VALID_STATUSES)}"}), 400

    current = note.status or 'draft'
    if target == current:
        return jsonify(_status_payload(note))

    if (current, target) not in _ALLOWED_STATUS_TRANSITIONS:
        return jsonify({
            "error": f"Cannot move a note from '{current}' to '{target}'.",
        }), 409

    note.status = target
    note.updated_at = datetime.utcnow()
    if target == 'signed':
        now = datetime.utcnow()
        note.signed_at = now
        # Signing implies approval — lock the raw transcript too.
        if note.approved_at is None:
            note.approved_at = now

    log_action(
        'note.status_change',
        user_id=current_user,
        resource_type='note',
        resource_id=note.id,
        extra={'from': current, 'to': target},
    )
    db.session.commit()
    return jsonify(_status_payload(note))


def _addendum_payload(addendum: NoteAddendum) -> dict:
    return {
        "id": addendum.id,
        "noteId": addendum.note_id,
        "authorId": addendum.author_id,
        "authorName": addendum.author_name,
        "content": addendum.content,
        "createdAt": addendum.created_at,
    }


@bp.route('/<string:id>/addenda', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def create_addendum(id):
    """Append an addendum to a signed note.

    Once a note is signed its body is immutable; an addendum is the only
    way to add further content. Rejected with 409 if the note isn't signed
    — before signing, the note is edited directly.

    The author name is derived server-side from the current user, never
    taken from the request body.
    """
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user, is_deleted=False).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    if note.status != 'signed':
        return jsonify({
            "error": "Addenda can only be added to signed notes.",
        }), 409

    data = request.get_json(silent=True) or {}
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({"error": "Addendum content is required"}), 400

    user = db.session.get(User, current_user)
    author_name = (
        ' '.join(filter(None, [user.first_name, user.last_name])).strip()
        if user else note.author_name
    )

    addendum = NoteAddendum(
        note_id=note.id,
        author_id=current_user,
        author_name=author_name[:100],
        content=content,
    )
    db.session.add(addendum)
    db.session.flush()
    log_action(
        'note.addendum_create',
        user_id=current_user,
        resource_type='note',
        resource_id=note.id,
        extra={'addendum_id': addendum.id},
    )
    db.session.commit()
    return jsonify(_addendum_payload(addendum)), 201


@bp.route('/<string:id>/delete', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def mark_note_as_deleted(id):
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    print('marking note as deleted', note)
    #TODO add ability for admin to delete any note

    # Idempotent: only stamp the trash timer on the active -> deleted
    # transition, so replaying the call on an already-trashed note doesn't
    # reset the retention clock.
    if not note.is_deleted:
        note.is_deleted = True
        note.is_deleted_timestamp = datetime.utcnow()
        note.updated_at = datetime.utcnow()

        log_action(
            'note.delete_soft',
            user_id=current_user,
            resource_type='note',
            resource_id=note.id,
        )
        db.session.commit()

    return jsonify({
        "id": note.id,
        "message": "Note moved to trash.",
        "deletedAt": note.is_deleted_timestamp,
        "retentionDays": settings_service.get_trash_retention_days(),
        "autoPurge": settings_service.get_trash_auto_purge(),
    })


@bp.route('/<string:id>/delete-permanently', methods=['DELETE'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def delete_note(id):
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404
    #TODO add ability for admin to delete any note
    # Two guards: the note must already be in the trash, and the org's
    # trash-retention window must have elapsed (so a record-keeping policy
    # can't be sidestepped by an immediate hard delete).
    if not note.is_deleted:
        return jsonify({"error": "Note must be in the trash before it can be permanently deleted"}), 409
    blocked = settings_service.trash_purge_block_reason(note.is_deleted_timestamp, noun="note")
    if blocked:
        return jsonify({"error": blocked}), 409

    print('permanently deleting note:', note)

    log_action(
        'note.delete_permanent',
        user_id=current_user,
        resource_type='note',
        resource_id=note.id,
        extra={'transcript_group_id': note.transcript_group_id},
    )
    db.session.delete(note)
    db.session.commit()

    return jsonify({
        "id": note.id,
        "message": "Note permanently deleted.",
    })


@bp.route('/<string:id>/restore', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def mark_note_as_restored(id):
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404
    #TODO add ability for admin to restore any note

    note.is_deleted = False
    note.is_deleted_timestamp = None
    note.updated_at = datetime.utcnow()

    log_action(
        'note.restore',
        user_id=current_user,
        resource_type='note',
        resource_id=note.id,
    )
    db.session.commit()

    return jsonify({
        "id": note.id,
        "message": "Note restored successfully.",
    })


def _safe_filename_stem(s: str, fallback: str) -> str:
    """Strip characters that don't belong in a download filename."""
    cleaned = re.sub(r'[^A-Za-z0-9._ -]+', '_', s).strip(' _-')
    return cleaned or fallback


@bp.route('/<string:id>/export/<string:fmt>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def export_note(id, fmt):
    """Download a note as PDF or DOCX.

    503 if the admin has globally disabled exports. 404 if the note isn't
    the caller's. Filename is derived from the template name + note date.
    """
    fmt = fmt.lower()
    if fmt not in ('pdf', 'docx'):
        return jsonify({"error": "format must be pdf or docx"}), 400
    if not settings_service.get_exports_enabled():
        return jsonify({"error": "Document exports are disabled by the administrator."}), 503

    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    template_name = None
    if note.template_id:
        tmpl = Template.query.get(note.template_id)
        if tmpl:
            template_name = tmpl.name

    if fmt == 'pdf':
        payload = note_export.render_pdf(note, template_name=template_name)
        mime = 'application/pdf'
    else:
        payload = note_export.render_docx(note, template_name=template_name)
        mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    date_stem = note.note_date.strftime('%Y-%m-%d') if note.note_date else ''
    stem = _safe_filename_stem(
        ' '.join(filter(None, [template_name or 'note', date_stem])),
        fallback=f'note_{note.id[:8]}',
    )
    filename = f'{stem}.{fmt}'

    log_action(
        'note.export',
        user_id=current_user,
        resource_type='note',
        resource_id=note.id,
        extra={'format': fmt},
    )
    db.session.commit()

    return Response(
        payload,
        mimetype=mime,
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Cache-Control': 'private, no-store',
        },
    )


@bp.route('/search', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def search_notes():
    """Full-text search over the caller's notes.

    Query string params:
      q                — search query (required, 2+ chars after trim)
      include_deleted  — 'true' to include soft-deleted notes (default false)

    Results are BM25-ranked and capped at SEARCH_RESULT_LIMIT. Each row
    carries `rawSnippet` / `markdownSnippet` with `<mark>...</mark>`
    highlights for the match, plus enough metadata to render the same
    columns as the regular notes list.
    """
    current_user = get_jwt_identity()
    q = (request.args.get('q') or '').strip()
    include_deleted = request.args.get('include_deleted', 'false').lower() == 'true'

    if len(q) < 2:
        return jsonify([])
    if len(q) > SEARCH_QUERY_MAX_LEN:
        q = q[:SEARCH_QUERY_MAX_LEN]

    hits = note_search.search_notes(
        user_id=current_user,
        query=q,
        include_deleted=include_deleted,
        limit=SEARCH_RESULT_LIMIT,
    )
    if not hits:
        return jsonify([])

    # Hydrate hit metadata in rank order. The FTS table is author-scoped at
    # query time, but we still filter by author_id on the ORM read as a
    # belt-and-suspenders check.
    note_ids = [h['note_id'] for h in hits]
    notes = Note.query.filter(
        Note.id.in_(note_ids), Note.author_id == current_user
    ).all()
    by_id = {n.id: n for n in notes}

    template_ids = {n.template_id for n in notes if n.template_id}
    template_names: dict[str, str] = {}
    if template_ids:
        for t in Template.query.filter(Template.id.in_(template_ids)).all():
            template_names[t.id] = t.name

    results = []
    for h in hits:
        note = by_id.get(h['note_id'])
        if note is None:
            # Index out of sync with the table (e.g. a hard delete that
            # bypassed the listener). Skip rather than 500.
            continue
        if note.is_deleted and not include_deleted:
            continue
        results.append({
            "id": note.id,
            "name": note.name,
            "status": note.status,
            "noteDate": note.note_date,
            "createdAt": note.created_at,
            "updatedAt": note.updated_at,
            "templateId": note.template_id,
            "templateName": template_names.get(note.template_id) if note.template_id else None,
            "noteType": note.note_type,
            "authorId": note.author_id,
            "isDeleted": note.is_deleted,
            "isDeletedTimestamp": note.is_deleted_timestamp,
            "participants": [
                {"id": p.id, "firstName": p.first_name, "lastName": p.last_name}
                for p in note.participants
            ],
            "rawSnippet": h['raw_snippet'],
            "markdownSnippet": h['markdown_snippet'],
        })

    return jsonify(results)


@bp.route('/user/<string:user_id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_notes_for_user(user_id):
    print("Getting notes for userId: " + user_id)

    current_user = get_jwt_identity()
    if current_user != user_id:
        return jsonify({"error": "Not authorized to access notes for this user"}), 403

    include_deleted = request.args.get('include_deleted', 'false').lower() == 'true'
    query = Note.query.filter_by(author_id=user_id)
    if not include_deleted:
        query = query.filter_by(is_deleted=False)

    notes = query.all()
    if not notes:
        return jsonify([]), 200

    # Bulk-resolve template names so the table can display + filter on
    # them without an N+1 (one query per note). Soft-deleted templates
    # are still mapped — the note keeps its name even if the template
    # was later trashed.
    template_ids = {n.template_id for n in notes if n.template_id}
    template_names: dict[int, str] = {}
    if template_ids:
        for t in Template.query.filter(Template.id.in_(template_ids)).all():
            template_names[t.id] = t.name

    notes_list = []

    try:
        for note in notes:
            participants = [
                {
                    "id": p.id,
                    "firstName": p.first_name,
                    "lastName": p.last_name,
                }
                for p in note.participants
            ]
            # noteContentRaw is intentionally omitted here — transcripts can
            # be many KB each and the list view doesn't render them. Fetch
            # the single-note endpoint when the raw text is actually needed.
            note_data = {
                "id": note.id,
                "name": note.name,
                "createdAt": note.created_at,
                "updatedAt": note.updated_at,
                "noteDate": note.note_date,
                "noteContentMarkdown": note.note_content_markdown,
                "status": note.status,
                "signedAt": note.signed_at,
                "participants": participants,
                "templateId": note.template_id,
                "templateName": template_names.get(note.template_id) if note.template_id else None,
                "noteType": note.note_type,
                "authorId": note.author_id,
                "isDeleted": note.is_deleted,
                "isDeletedTimestamp": note.is_deleted_timestamp,
            }

            notes_list.append(note_data)
    except Exception as e:
        print(f"Error accessing participants: {str(e)}")
        notes_list = []

    return jsonify(notes_list)
