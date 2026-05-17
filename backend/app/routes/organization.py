"""Admin-managed organization — the practice or clinic this install belongs to.

There is one Organization row per install. It is normally created during
first-run setup (routes/setup.py); this blueprint lets an admin view and
rename it afterward. The PUT is also how an install that predates the
organization feature gets one: it creates the row and adopts every user that
still has no organization.
"""
from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity

from app.extensions import db
from app.models import Organization, User
from app.security.auth import require_admin
from app.services.audit import log_action

bp = Blueprint("organization", __name__, url_prefix="/api/admin/organization")

ORG_NAME_MAX = 255


def _serialize(org):
    return {"id": org.id, "name": org.name} if org else None


@bp.route("", methods=["GET"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def get_organization():
    return jsonify({"organization": _serialize(Organization.query.first())})


@bp.route("", methods=["PUT"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_organization():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    if len(name) > ORG_NAME_MAX:
        return jsonify({"error": f"Name must be {ORG_NAME_MAX} characters or fewer"}), 400

    org = Organization.query.first()
    if org is None:
        # An install created before the organization feature existed — make
        # the row and adopt every user that still has no organization.
        org = Organization(name=name)
        db.session.add(org)
        db.session.flush()
        adopted = User.query.filter(User.organization_id.is_(None)).update(
            {User.organization_id: org.id}, synchronize_session=False
        )
        log_action(
            "organization.create",
            user_id=get_jwt_identity(),
            resource_type="organization",
            resource_id=org.id,
            extra={"name": org.name, "users_adopted": adopted},
        )
    else:
        org.name = name
        log_action(
            "organization.update",
            user_id=get_jwt_identity(),
            resource_type="organization",
            resource_id=org.id,
            extra={"name": org.name},
        )
    db.session.commit()
    return jsonify({"organization": _serialize(org)})
