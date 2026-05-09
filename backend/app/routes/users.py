from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from werkzeug.security import generate_password_hash

from app.extensions import db
from app.models import User
from app.security.auth import require_admin

bp = Blueprint("users", __name__)


@bp.route('/api/getAllUsers', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def get_all_users():
    users = User.query.all()
    if not users:
        return jsonify({"error": "No users found"}), 404

    users_list = [{
        "id": user.id,
        "email": user.email,
        "firstName": user.first_name,
        "lastName": user.last_name,
        "role": user.role,
        "createdAt": user.created_at,
        "lastLogin": user.last_login,
    } for user in users]

    return jsonify(users_list)


@bp.route('/api/admin/users', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def admin_create_user():
    data = request.get_json(silent=True) or {}

    required = ('firstName', 'lastName', 'email', 'password')
    if not all(data.get(k) for k in required):
        return jsonify({"error": "firstName, lastName, email, and password are required"}), 400

    role = data.get('role', 'user')
    if role not in ('user', 'admin'):
        return jsonify({"error": "Invalid role"}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({"error": "User email already exists"}), 400

    new_user = User(
        first_name=data['firstName'],
        last_name=data['lastName'],
        email=data['email'],
        role=role,
        password=generate_password_hash(data['password'], method='pbkdf2:sha256'),
        last_login=None,
    )
    db.session.add(new_user)
    db.session.commit()

    return jsonify({
        "id": new_user.id,
        "email": new_user.email,
        "firstName": new_user.first_name,
        "lastName": new_user.last_name,
        "role": new_user.role,
        "createdAt": new_user.created_at,
        "lastLogin": new_user.last_login,
    }), 201
