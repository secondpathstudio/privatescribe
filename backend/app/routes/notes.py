import uuid
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models import Note, Participant, Template

bp = Blueprint("notes", __name__, url_prefix="/api/notes")


@bp.route('', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def create_note():
    data = request.get_json()
    print('creating note', data)

    note_date = datetime.utcnow()
    if 'noteDate' in data:
        note_date = datetime.fromisoformat(data['noteDate'].replace("Z", ""))

    if not all(k in data for k in (
        'noteContentRaw',
        'noteContentMarkdown',
        'authorName',
        'noteTemplate',
        'noteDate',
    )):
        print('missing required fields', data)
        return jsonify({"error": "Missing required fields"}), 400

    if 'templateId' in data and data['templateId']:
        template = Template.query.get(data['templateId'])
        if not template:
            print('template not found', data['templateId'])
            return jsonify({"error": f"Template with ID {data['templateId']} not found"}), 400

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
        template_id=data['noteTemplate'],
        is_deleted=False,
        is_deleted_timestamp=None,
        transcript_group_id=transcript_group_id,
        participants=participants,
        author_id=current_user,
    )

    print('adding note', new_note)

    db.session.add(new_note)
    db.session.flush()
    db.session.commit()

    participants_response = []
    try:
        for participant in new_note.participants:
            participant_info = {
                "id": participant.id,
                "first_name": participant.firstName,
                "last_name": participant.lastName if hasattr(participant, 'lastName') else None,
                "email": participant.email if hasattr(participant, 'email') else None,
            }
            participants_response.append(participant_info)
    except Exception as e:
        print(f"Error accessing participants: {str(e)}")
        participants_response = []

    return jsonify({
        "id": new_note.id,
        "createdAt": new_note.created_at,
        "updatedAt": new_note.updated_at,
        "noteContentRaw": new_note.note_content_raw,
        "noteContentMarkdown": new_note.note_content_markdown,
        "noteContentSegments": new_note.note_content_segments,
        "participants": data['participants'],
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


@bp.route('/<string:id>', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_note(id):
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    data = request.get_json()

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

    db.session.commit()

    return jsonify({
        "id": note.id,
        "message": "Note added to trash, will be permanently deleted in 30 days",
        "deletedAt": note.is_deleted_timestamp,
    })


@bp.route('/<string:id>/delete-permanently', methods=['DELETE'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def delete_note(id):
    current_user = get_jwt_identity()
    note = Note.query.filter_by(id=id, author_id=current_user).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404

    print('permanently deleting note:', note)
    #TODO add ability for admin to delete any note

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

    notes_list = []

    try:
        for note in notes:
            participant_ids = [participant.id for participant in note.participants]

            note_data = {
                "id": note.id,
                "createdAt": note.created_at,
                "updatedAt": note.updated_at,
                "noteDate": note.note_date,
                "noteContentRaw": note.note_content_raw,
                "noteContentMarkdown": note.note_content_markdown,
                "participantIds": participant_ids,
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
