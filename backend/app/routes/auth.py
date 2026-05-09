from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (create_access_token, create_refresh_token,
                                get_jwt_identity, jwt_required)
from werkzeug.security import check_password_hash

from app.extensions import db, limiter
from app.models import User
from app.security import sqlcipher
from app.security.secrets import is_backup_key_acknowledged

bp = Blueprint("auth", __name__)


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
        },
    })


@bp.route('/api/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data = request.get_json()

    if not data.get('email') or not data.get('password'):
        return jsonify({"error": "Email and password are required"}), 400

    user = User.query.filter_by(email=data['email']).first()

    if user and check_password_hash(user.password, data['password']):
        access_token = create_access_token(identity=user.id)
        refresh_token = create_refresh_token(identity=user.id)

        user.last_login = datetime.utcnow()
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
            },
        }
        # First-admin-login one-shot: surface the SQLCipher key so the operator
        # can back it up. Cleared the moment any admin acknowledges via
        # /api/acknowledge-backup-key — never returned by login again after that.
        if user.role == 'admin' and not is_backup_key_acknowledged():
            response_body["backup_key"] = sqlcipher.current_key()
        return jsonify(response_body), 200

    return jsonify({"error": "Invalid username or password"}), 401


@bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    current_user = get_jwt_identity()
    new_access_token = create_access_token(identity=current_user)
    return jsonify(access_token=new_access_token)
