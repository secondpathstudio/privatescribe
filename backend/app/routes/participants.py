import logging
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models import Participant
from app.services.audit import log_action

logger = logging.getLogger(__name__)

bp = Blueprint("participants", __name__, url_prefix="/api/participants")


@bp.route('', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def create_participant():
    data = request.get_json(silent=True) or {}

    if not all(k in data for k in ('firstName',)):
        return jsonify({"error": "Missing required fields"}), 400

    current_user = get_jwt_identity()

    new_participant = Participant(
        first_name=data['firstName'],
        last_name=data['lastName'] if 'lastName' in data else None,
        email=data['email'] if 'email' in data else None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        author_id=current_user,
    )

    db.session.add(new_participant)
    db.session.flush()
    log_action(
        'participant.create',
        user_id=current_user,
        resource_type='participant',
        resource_id=new_participant.id,
        extra={
            'first_name': new_participant.first_name,
            'last_name': new_participant.last_name,
        },
    )
    db.session.commit()

    return jsonify({
        "id": new_participant.id,
        "createdAt": new_participant.created_at,
        "updatedAt": new_participant.updated_at,
        "firstName": new_participant.first_name,
        "lastName": new_participant.last_name,
        "authorId": new_participant.author_id,
    }), 201


@bp.route('/<string:user_id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_participants_for_user(user_id):
    current_user = get_jwt_identity()

    if current_user != user_id:
        return jsonify({"error": "Not authorized to access templates for this user"}), 403

    participants = Participant.query.filter_by(author_id=user_id).all()

    # Participant records are author-scoped contacts (names, emails) — PHI
    # under HIPAA — so reading the list is audited even when it's empty.
    log_action(
        'participant.list',
        user_id=current_user,
        resource_type='participant',
        extra={'count': len(participants)},
    )
    db.session.commit()

    if not participants:
        return jsonify([]), 200

    participant_list = []

    try:
        for participant in participants:
            participant_data = {
                "id": participant.id,
                "firstName": participant.first_name,
                "lastName": participant.last_name,
                "email": participant.email,
                "createdAt": participant.created_at,
                "updatedAt": participant.updated_at,
            }
            participant_list.append(participant_data)
    except Exception as e:
        logger.error(f"Error getting participants: {e}")
        participant_list = []

    return jsonify(participant_list)
