from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (create_access_token, create_refresh_token,
                                get_jwt_identity, jwt_required)
from werkzeug.security import check_password_hash

from app.extensions import db, limiter
from app.models import User
from app.security.secrets import is_backup_key_acknowledged
from app.services.audit import log_action

bp = Blueprint("auth", __name__)


def _pending_backup_key_ack(user) -> bool:
    """True when this user needs to nudge through the backup-key flow.
    Currently any admin who hasn't acknowledged the key (or hasn't since the
    last rotation) — non-admins never see the banner."""
    return user.role == 'admin' and not is_backup_key_acknowledged()


@bp.route('/api/validateToken', methods=['GET'])
@jwt_required()
def validate_token():
    user = User.query.get(get_jwt_identity())
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({
        "message": "Valid token",
        "user": {
            "id": user.id,
            "email": user.email,
            "firstName": user.first_name,
            "lastName": user.last_name,
            "role": user.role,
            "lastLogin": user.last_login,
            "forcePasswordChange": user.force_password_change,
            "pendingBackupKeyAcknowledgment": _pending_backup_key_ack(user),
        },
    })


@bp.route('/api/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data = request.get_json(silent=True) or {}

    if not data.get('email') or not data.get('password'):
        return jsonify({"error": "Email and password are required"}), 400

    attempted_email = data['email']
    user = User.query.filter_by(email=attempted_email).first()

    if user and check_password_hash(user.password, data['password']):
        access_token = create_access_token(identity=user.id)
        refresh_token = create_refresh_token(identity=user.id)

        user.last_login = datetime.utcnow()
        log_action(
            'auth.login',
            user_id=user.id,
            user_email=user.email,
        )
        db.session.commit()

        response_body = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": {
                "id": user.id,
                "email": user.email,
                "firstName": user.first_name,
                "lastName": user.last_name,
                "role": user.role,
                "lastLogin": user.last_login,
                "forcePasswordChange": user.force_password_change,
                # Drives the warning banner. The key itself is never returned
                # by login — admins must password-re-auth on /admin/encryption
                # to actually see it.
                "pendingBackupKeyAcknowledgment": _pending_backup_key_ack(user),
            },
        }
        return jsonify(response_body), 200

    log_action(
        'auth.login_failed',
        user_id=user.id if user else None,
        user_email=attempted_email,
        status='failure',
        extra={
            'reason': 'invalid_password' if user else 'unknown_email',
        },
    )
    db.session.commit()
    return jsonify({"error": "Invalid username or password"}), 401


@bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    current_user = get_jwt_identity()
    new_access_token = create_access_token(identity=current_user)
    log_action('auth.token_refresh', user_id=current_user)
    db.session.commit()
    return jsonify(access_token=new_access_token)
