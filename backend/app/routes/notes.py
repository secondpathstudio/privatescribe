import uuid
from datetime import datetime

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models import AudioFile, Note, Participant, Template
from app.services import audio_storage
from app.services import settings as settings_service
from app.services.audit import diff_fields, log_action

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

    # Empty/missing noteTemplate is allowed — the note just stores the raw
    # transcript with no template association. Coerce '' to None so the FK
    # column doesn't receive a stringy empty value.
    template_id = data.get('noteTemplate') or None
    if template_id:
        template = Template.query.get(template_id)
        if not template:
            print('template not found', template_id)
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

    current_user = get_jwt_identity()

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

    new_note = Note(
        note_content_raw=data['noteContentRaw'],
        note_content_markdown=data['noteContentMarkdown'],
        note_content_segments=data.get('noteContentSegments'),
        note_type='text',
        note_date=note_date,
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
        "createdAt": new_note.created_at,
        "updatedAt": new_note.updated_at,
        "noteContentRaw": new_note.note_content_raw,
        "noteContentMarkdown": new_note.note_content_markdown,
        "noteContentSegments": new_note.note_content_segments,
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
        "createdAt": note.created_at,
        "updatedAt": note.updated_at,
        "noteDate": note.note_date,
        "noteContentRaw": note.note_content_raw,
        "noteContentMarkdown": note.note_content_markdown,
        "noteContentSegments": note.note_content_segments,
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

    # Snapshot pre-edit values so we can record a diff in the audit log.
    # note_content_markdown can be many KB; record just "changed?" instead
    # of the full before/after to keep the log compact.
    before_markdown = note.note_content_markdown
    before_note_type = note.note_type
    before_participant_ids = sorted(p.id for p in note.participants)

    # template_id is intentionally not updatable — a note is locked to its
    # original template. Re-recording with a different template should create
    # a new note instead.
    note.note_content_markdown = data.get('noteContentMarkdown', note.note_content_markdown)
    note.note_type = data.get('noteType', note.note_type)
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
                'participant_ids': before_participant_ids,
            },
            {
                'note_type': note.note_type,
                'participant_ids': after_participant_ids,
            },
        )
        if before_markdown != note.note_content_markdown:
            diff['note_content_markdown'] = {'changed': True}
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
            "createdAt": note.created_at,
            "updatedAt": note.updated_at,
            "noteDate": note.note_date,
            "noteContentRaw": note.note_content_raw,
            "noteContentMarkdown": note.note_content_markdown,
            "noteContentSegments": note.note_content_segments,
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
                "createdAt": note.created_at,
                "updatedAt": note.updated_at,
                "noteDate": note.note_date,
                "noteContentMarkdown": note.note_content_markdown,
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
