"""Per-request organization context — the tenant boundary's foundation.

PrivateScribe 2.0 server mode hosts multiple practices/departments of a single
covered entity on one box (roadmap Phase 8). The boundary is the authenticated
user's ``organization_id``: every cross-user query is later confined to it, and
``organization_id`` is denormalized onto the PHI models so the filter is a
direct, indexed column rather than a join through the author.

This module resolves "which org is this request acting in" once, and offers a
guard for endpoints that must have an org. Nothing here applies a filter yet —
the per-endpoint scoping lands in the later Phase 8 commits; this is the piece
they all call.

Mode-aware by design: in ``standalone`` there is a single user and no tenant
boundary, so the guard is a pass-through. Only ``server`` mode enforces that a
request carries an org.
"""
from functools import wraps

from flask import current_app, g, jsonify
from flask_jwt_extended import get_jwt_identity

from app.deployment import SERVER
from app.extensions import db
from app.models import User


def org_id_for_user(user_id: str | None) -> str | None:
    """Return a user's ``organization_id``, or ``None`` if unknown/org-less.

    Pure lookup (no request state), so it's usable from CLI/jobs and is the
    testable core of ``current_org_id``.
    """
    if not user_id:
        return None
    return db.session.query(User.organization_id).filter(User.id == user_id).scalar()


def current_org_id() -> str | None:
    """Organization of the JWT-authenticated user, memoized for the request.

    Returns ``None`` when there is no identity or the user has no org (the
    latter is a normal standalone state and an error state in server mode —
    see ``require_org``).
    """
    if "current_org_id" not in g:
        g.current_org_id = org_id_for_user(get_jwt_identity())
    return g.current_org_id


def _server_mode() -> bool:
    return current_app.config.get("DEPLOYMENT_MODE") == SERVER


def require_org(fn):
    """Guard: in server mode, reject a request whose user has no organization.

    A no-op in standalone (no tenant boundary there). Applied to the
    org-scoped endpoints in the later Phase 8 commits; defined here so the
    boundary has one consistent gate rather than ad-hoc checks.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if _server_mode() and current_org_id() is None:
            return jsonify({"error": "No organization context for this account."}), 403
        return fn(*args, **kwargs)

    return wrapper
