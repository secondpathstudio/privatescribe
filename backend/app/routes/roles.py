"""Role management — admin-only CRUD for the app-wide roles that scope
template sharing. See models/role.py. Assigning roles to users lives in
routes/users.py alongside the rest of admin user management.
"""
from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity

from app.extensions import db
from app.models import Role
from app.security.auth import require_admin
from app.services.audit import log_action

bp = Blueprint("roles", __name__, url_prefix="/api/roles")

ROLE_NAME_MAX = 50


def _serialize_role(role: Role) -> dict:
    return {
        "id": role.id,
        "name": role.name,
        "createdAt": role.created_at,
    }


@bp.route("", methods=["GET"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def list_roles():
    roles = Role.query.order_by(Role.name).all()
    return jsonify([_serialize_role(r) for r in roles])


@bp.route("", methods=["POST"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def create_role():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    if len(name) > ROLE_NAME_MAX:
        return jsonify({"error": f"Name must be {ROLE_NAME_MAX} characters or fewer"}), 400
    if Role.query.filter_by(name=name).first():
        return jsonify({"error": "A role with that name already exists"}), 409

    role = Role(name=name)
    db.session.add(role)
    db.session.flush()
    log_action(
        "role.create",
        user_id=get_jwt_identity(),
        resource_type="role",
        resource_id=role.id,
        extra={"name": role.name},
    )
    db.session.commit()
    return jsonify(_serialize_role(role)), 201


@bp.route("/<string:role_id>", methods=["DELETE"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def delete_role(role_id):
    """Delete a role. The user_roles / template_roles join rows are removed
    with it — users lose the role and templates lose that sharing."""
    role = Role.query.get(role_id)
    if not role:
        return jsonify({"error": "Role not found"}), 404
    log_action(
        "role.delete",
        user_id=get_jwt_identity(),
        resource_type="role",
        resource_id=role.id,
        extra={"name": role.name},
    )
    db.session.delete(role)
    db.session.commit()
    return jsonify({"id": role_id, "message": "Role deleted."}), 200
