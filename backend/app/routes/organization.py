"""Organization management — the practices/departments on this server.

A standalone install has one Organization; a server hosts several (one covered
entity's departments). An org-admin views and renames *their own* org via the
singular endpoints; a super-admin (central IT) lists and creates orgs via the
plural endpoints. First-run setup (routes/setup.py) creates the first org.
"""
from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity

from app.extensions import db
from app.models import Organization, User
from app.security.auth import require_admin, require_super_admin
from app.services.audit import log_action

bp = Blueprint("organization", __name__, url_prefix="/api/admin/organization")

ORG_NAME_MAX = 255


def _serialize(org):
    return {"id": org.id, "name": org.name} if org else None


@bp.route("", methods=["GET"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def get_organization():
    """The acting admin's own organization (None for an org-less super-admin)."""
    actor = User.query.get(get_jwt_identity())
    return jsonify({"organization": _serialize(actor.organization if actor else None)})


@bp.route("", methods=["PUT"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_organization():
    """Rename the acting admin's own organization.

    If the actor has no org *and* no organization exists yet (a fresh or
    pre-organization-feature install), create one and adopt every org-less
    user — the legacy single-install upgrade path. Once any org exists, an
    org-less actor (e.g. a super-admin) must use the plural create endpoint
    instead, so this can't silently sweep a multi-org server into one org.
    """
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    if len(name) > ORG_NAME_MAX:
        return jsonify({"error": f"Name must be {ORG_NAME_MAX} characters or fewer"}), 400

    actor = User.query.get(get_jwt_identity())
    org = actor.organization if actor else None

    if org is None:
        if Organization.query.count() > 0:
            return jsonify({
                "error": "You don't belong to an organization. Create or select one via organization management."
            }), 400
        # Legacy/standalone upgrade: no org exists at all — create it and adopt
        # every org-less user (including this actor).
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


@bp.route("/list", methods=["GET"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_super_admin
def list_organizations():
    """All organizations with their user counts (super-admin / central IT)."""
    orgs = Organization.query.order_by(Organization.name).all()
    return jsonify({"organizations": [
        {"id": o.id, "name": o.name, "userCount": len(o.users)} for o in orgs
    ]})


@bp.route("/create", methods=["POST"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_super_admin
def create_organization():
    """Create a new organization/department (super-admin / central IT)."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    if len(name) > ORG_NAME_MAX:
        return jsonify({"error": f"Name must be {ORG_NAME_MAX} characters or fewer"}), 400

    org = Organization(name=name)
    db.session.add(org)
    db.session.flush()
    log_action(
        "organization.create",
        user_id=get_jwt_identity(),
        resource_type="organization",
        resource_id=org.id,
        extra={"name": org.name},
    )
    db.session.commit()
    return jsonify({"organization": _serialize(org)}), 201
