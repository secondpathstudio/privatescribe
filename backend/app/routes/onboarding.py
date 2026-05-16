"""Onboarding wizard endpoints.

The first-run admin wizard (frontend route /welcome) calls these to fetch the
starter-template catalog and, on finish, seed the picked templates and mark
onboarding complete. `onboarding_completed` is a global SystemSetting the
frontend reads to decide whether to route a fresh admin into the wizard.
"""
from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.security.auth import require_admin
from app.services import settings as settings_service
from app.services import starter_templates
from app.services.audit import log_action

bp = Blueprint("onboarding", __name__, url_prefix="/api/onboarding")


@bp.route("/status", methods=["GET"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def onboarding_status():
    """Whether first-run onboarding has been completed (a global flag)."""
    return jsonify({"completed": settings_service.get_onboarding_completed()})


@bp.route("/catalog", methods=["GET"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def onboarding_catalog():
    """Use-case catalog so the wizard can show what each option includes."""
    return jsonify({"useCases": starter_templates.catalog()})


@bp.route("/complete", methods=["POST"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def onboarding_complete():
    """Finish onboarding: seed the picked starter templates, set the flag.

    The seeded templates, the audit row, and the completion flag all land in
    a single commit (set_value commits the open session), so a failure can't
    leave a half-finished state.
    """
    data = request.get_json(silent=True) or {}
    use_cases = data.get("useCases") or []
    if not isinstance(use_cases, list):
        return jsonify({"error": "useCases must be a list"}), 400

    current_user = get_jwt_identity()
    created = starter_templates.seed_for_user(current_user, use_cases)
    log_action(
        "onboarding.complete",
        user_id=current_user,
        extra={"use_cases": use_cases, "templates_created": len(created)},
    )
    settings_service.set_value(settings_service.ONBOARDING_COMPLETED, True)

    return jsonify({
        "completed": True,
        "templates": [{"id": t.id, "name": t.name} for t in created],
    }), 201
