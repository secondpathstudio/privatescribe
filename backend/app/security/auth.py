from functools import wraps

from flask import jsonify, request
from flask_jwt_extended import (get_jwt, get_jwt_identity, jwt_required,
                                verify_jwt_in_request)

from app.extensions import db
from app.models.user import User
from app.security import sessions


# Privilege tiers stored in User.role. Distinct from the Role model, which
# holds custom org roles for template sharing — these are auth privilege
# levels (Phase 8 item 3):
#   user        — regular user
#   admin       — org-admin: admin rights within their own organization
#   super_admin — central IT: spans all orgs, manages the server
# A super_admin is a strict superset of admin, so require_admin accepts both;
# the org-vs-all-orgs distinction is applied in the query layer (items 4-5).
ROLE_USER = 'user'
ROLE_ADMIN = 'admin'
ROLE_SUPER_ADMIN = 'super_admin'
_ADMIN_ROLES = frozenset({ROLE_ADMIN, ROLE_SUPER_ADMIN})


def is_admin(user) -> bool:
    """True for an org-admin or a super-admin (any admin-tier privilege)."""
    return user is not None and user.role in _ADMIN_ROLES


def is_super_admin(user) -> bool:
    """True only for a super-admin (central IT, spans organizations)."""
    return user is not None and user.role == ROLE_SUPER_ADMIN


def _elevation_required_response():
    """403 telling a kiosk (no-login) session to step up with the password.

    The frontend catches this `code` and shows the re-auth modal, which calls
    /api/auth/elevate to swap the kiosk token for a full one."""
    return jsonify({
        "error": "Re-enter your password to access admin settings.",
        "code": "elevation_required",
    }), 403


def require_admin(fn):
    @wraps(fn)
    @jwt_required()
    def wrapper(*args, **kwargs):
        # A kiosk (no-login) token can carry an admin identity, but admin
        # routes stay gated until the session is elevated with the password —
        # this is the server-side half of step-up, so hitting the API
        # directly can't bypass the frontend re-auth modal.
        if get_jwt().get('kiosk'):
            return _elevation_required_response()
        user = User.query.get(get_jwt_identity())
        if not is_admin(user):
            return jsonify({"error": "Admin privileges required"}), 403
        return fn(*args, **kwargs)
    return wrapper


def require_super_admin(fn):
    """Guard for server-wide operations only central IT may perform (creating
    organizations, cross-org actions). Org-admins are rejected."""
    @wraps(fn)
    @jwt_required()
    def wrapper(*args, **kwargs):
        if get_jwt().get('kiosk'):
            return _elevation_required_response()
        user = User.query.get(get_jwt_identity())
        if not is_super_admin(user):
            return jsonify({"error": "Super-admin privileges required"}), 403
        return fn(*args, **kwargs)
    return wrapper


# Endpoints a force_password_change user must still reach: the password-change
# endpoint itself, the "who am I" check the SPA runs on every protected route,
# token refresh, and logout. Session validity (revoked / idle / deactivated)
# is NOT exempted anywhere — a dead session fails everything.
_PASSWORD_CHANGE_EXEMPT_ENDPOINTS = frozenset({
    'auth.validate_token',
    'auth.refresh',
    'auth.logout',
    'users.change_own_password',
})


def request_guard():
    """App-wide before_request guard for authenticated requests.

    Registered in create_app() rather than per-route, so a newly added
    blueprint can't silently miss it. For any request carrying a valid access
    token it enforces, in order:

      1. The server-side session must exist and not be revoked   -> 401
      2. The session must not be idle-expired                    -> 401 (+revoke)
      3. The user account must still be active                   -> 401 (+revoke)
      4. force_password_change confines the user to a few routes -> 403

    A request with no token (public route, or pre-login) is left alone — the
    route's own @jwt_required, if any, handles rejection. /refresh is skipped
    here because it carries a refresh token, not an access token; it
    self-validates its session (see routes/auth.py).
    """
    if request.method == 'OPTIONS':
        return  # CORS preflight carries no auth
    if request.endpoint is None:
        return  # unrouted request — let Flask 404 it

    # optional=True: a missing token is fine (public route). A present-but-
    # invalid token (expired, a refresh token, malformed) raises — swallow it
    # and defer to the route's own @jwt_required.
    try:
        verify_jwt_in_request(optional=True)
    except Exception:
        return
    identity = get_jwt_identity()
    if not identity:
        return  # unauthenticated request

    session = sessions.get_session(get_jwt().get('sid'))
    if session is None or session.revoked:
        return jsonify({
            "error": "Your session has ended. Please sign in again.",
            "code": "session_revoked",
        }), 401

    if sessions.is_idle_expired(session):
        sessions.revoke_session(session, 'idle_timeout')
        db.session.commit()
        return jsonify({
            "error": "Signed out due to inactivity. Please sign in again.",
            "code": "session_timeout",
        }), 401

    user = User.query.get(identity)
    if user is None:
        return  # vanished user — let the route 404 it
    if not user.is_active:
        sessions.revoke_session(session, 'user_deactivated')
        db.session.commit()
        return jsonify({
            "error": "This account has been deactivated.",
            "code": "account_deactivated",
        }), 401

    if user.force_password_change and request.endpoint not in _PASSWORD_CHANGE_EXEMPT_ENDPOINTS:
        return jsonify({
            "error": "You must change your password before continuing.",
            "code": "password_change_required",
        }), 403

    # Session is good — record activity (throttled write).
    if sessions.touch(session):
        db.session.commit()
