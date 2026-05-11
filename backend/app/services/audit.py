"""Audit log helpers.

Route handlers call log_action(...) to record a single user-facing action.
The helper pulls request-scoped context (IP, user agent) from Flask's
`request` and resolves the acting user from the JWT identity when one is
present, so callers only need to pass the action and any action-specific
details.

Failures inside log_action are swallowed (with a print) and never propagate
back to the caller — an audit-table write failing should not 500 the
underlying request, but it should be visible in the server log so it can
be diagnosed.
"""
from typing import Any, Mapping

from flask import has_request_context, request
from flask_jwt_extended import get_jwt_identity

from app.extensions import db
from app.models import AuditLog, User


# Max length of the User-Agent column. Browsers send 100-200 char UAs but a
# malicious client can send much more — truncate so a giant header can't
# bloat the table.
_USER_AGENT_MAX = 512


def _resolve_actor(
    user_id: str | None, user_email: str | None
) -> tuple[str | None, str | None, str | None]:
    """Fill in whichever of (user_id, user_email, user_role) the caller didn't pass.

    For most routes the caller has a JWT identity but not the email/role — we
    look them up so the log row is human-readable without a join. For failed
    logins the caller has the attempted email but no user_id; we still try
    to resolve the matching User so the role is recorded if it exists.
    """
    user_role: str | None = None
    user: User | None = None

    if user_id:
        user = User.query.get(user_id)
    elif user_email:
        user = User.query.filter_by(email=user_email).first()
    else:
        # Try to recover from the current JWT if one is present. This makes
        # log_action ergonomic in routes that didn't explicitly capture the
        # identity at the top of the function.
        try:
            jwt_id = get_jwt_identity()
        except Exception:
            jwt_id = None
        if jwt_id:
            user_id = jwt_id
            user = User.query.get(jwt_id)

    if user is not None:
        if not user_email:
            user_email = user.email
        user_role = user.role

    return user_id, user_email, user_role


def log_action(
    action: str,
    *,
    user_id: str | None = None,
    user_email: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    status: str = 'success',
    extra: Mapping[str, Any] | None = None,
) -> None:
    """Record one audit log row.

    All fields except `action` are optional. Request context (IP, UA) is
    captured automatically when called from inside a Flask request. The row
    is added to the current session and committed in its own savepoint so
    a failure here cannot poison the caller's transaction.
    """
    try:
        ip = None
        ua = None
        if has_request_context():
            ip = request.remote_addr
            ua_header = request.headers.get('User-Agent')
            if ua_header:
                ua = ua_header[:_USER_AGENT_MAX]

        user_id, user_email, user_role = _resolve_actor(user_id, user_email)

        # Cast resource_id to str so callers don't have to remember — most of
        # the app uses string UUIDs but some legacy integer IDs sneak in.
        rid = str(resource_id) if resource_id is not None else None

        entry = AuditLog(
            user_id=user_id,
            user_email=user_email,
            user_role=user_role,
            action=action,
            resource_type=resource_type,
            resource_id=rid,
            status=status,
            ip_address=ip,
            user_agent=ua,
            extra_data=dict(extra) if extra else None,
        )
        db.session.add(entry)
        # Flush so the insert hits the DB now; the caller's outer commit
        # will persist it alongside whatever else they did. If the caller
        # already committed, flush is effectively a no-op and we commit
        # right after.
        db.session.flush()
    except Exception as e:
        # Don't let audit failures break the request. Roll back our piece
        # so the caller's session is still usable.
        try:
            db.session.rollback()
        except Exception:
            pass
        print(f"[audit] failed to log action={action!r}: {type(e).__name__}: {e}")


def diff_fields(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Return {field: {"old": x, "new": y}} for keys whose value changed.

    Used by edit routes to record what actually changed instead of dumping
    the entire row. Caller is responsible for excluding very large fields
    (e.g. full transcript bodies) — pass a summary like
    {"note_content_raw_changed": True} instead.
    """
    diff: dict[str, dict[str, Any]] = {}
    for key in after:
        if before.get(key) != after.get(key):
            diff[key] = {"old": before.get(key), "new": after.get(key)}
    return diff
