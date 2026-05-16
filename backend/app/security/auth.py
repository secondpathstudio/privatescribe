from functools import wraps

from flask import jsonify, request
from flask_jwt_extended import (get_jwt_identity, jwt_required,
                                verify_jwt_in_request)

from app.models.user import User


def require_admin(fn):
    @wraps(fn)
    @jwt_required()
    def wrapper(*args, **kwargs):
        user = User.query.get(get_jwt_identity())
        if not user or user.role != 'admin':
            return jsonify({"error": "Admin privileges required"}), 403
        return fn(*args, **kwargs)
    return wrapper


# Endpoints an authenticated user must still reach while force_password_change
# is set: the password-change endpoint itself, the "who am I" check the SPA
# runs on every protected route, and token refresh so a slow change doesn't
# 401 the user out midway.
_PASSWORD_CHANGE_EXEMPT_ENDPOINTS = frozenset({
    'auth.validate_token',
    'auth.refresh',
    'users.change_own_password',
})


def enforce_password_change():
    """before_request guard: a user flagged force_password_change may do
    nothing but rotate their password.

    Registered app-wide in create_app() rather than per-route, so a newly
    added blueprint can't silently miss it. Without this, force_password_change
    is only a frontend redirect — a direct API call carrying the user's
    (still valid) access token would otherwise sail straight through.
    """
    if request.method == 'OPTIONS':
        return  # CORS preflight carries no auth
    if request.endpoint is None or request.endpoint in _PASSWORD_CHANGE_EXEMPT_ENDPOINTS:
        return
    # optional=True: a missing token is fine (public route) — defer to the
    # route's own @jwt_required. A present-but-invalid token raises; swallow
    # it and defer for the same reason.
    try:
        verify_jwt_in_request(optional=True)
    except Exception:
        return
    identity = get_jwt_identity()
    if not identity:
        return
    user = User.query.get(identity)
    if user and user.force_password_change:
        return jsonify({
            "error": "You must change your password before continuing.",
            "code": "password_change_required",
        }), 403
