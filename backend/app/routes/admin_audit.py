"""Admin-only access to the audit log."""
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from sqlalchemy import desc

from app.models import AuditLog
from app.security.auth import require_admin

bp = Blueprint("admin_audit", __name__, url_prefix="/api/admin/audit-log")

# Cap how many rows a single page can return so a malicious/buggy client
# can't ask for a million rows and OOM the server.
PAGE_SIZE_MAX = 500
PAGE_SIZE_DEFAULT = 100


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Accept both "Z" and offset suffixes; fromisoformat handles offsets
        # natively in 3.11+.
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@bp.route('', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def list_audit_log():
    """Return audit log rows, newest first, with optional filters.

    Query params:
      user_id, user_email, action, resource_type, resource_id, status
      since, until (ISO8601)
      limit (default 100, max 500), offset (default 0)
    """
    q = AuditLog.query

    user_id = request.args.get('user_id')
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)

    user_email = request.args.get('user_email')
    if user_email:
        q = q.filter(AuditLog.user_email == user_email)

    action = request.args.get('action')
    if action:
        q = q.filter(AuditLog.action == action)

    resource_type = request.args.get('resource_type')
    if resource_type:
        q = q.filter(AuditLog.resource_type == resource_type)

    resource_id = request.args.get('resource_id')
    if resource_id:
        q = q.filter(AuditLog.resource_id == resource_id)

    status = request.args.get('status')
    if status:
        q = q.filter(AuditLog.status == status)

    since = _parse_iso(request.args.get('since'))
    if since:
        q = q.filter(AuditLog.created_at >= since)

    until = _parse_iso(request.args.get('until'))
    if until:
        q = q.filter(AuditLog.created_at <= until)

    try:
        limit = int(request.args.get('limit', PAGE_SIZE_DEFAULT))
    except (TypeError, ValueError):
        limit = PAGE_SIZE_DEFAULT
    limit = max(1, min(limit, PAGE_SIZE_MAX))

    try:
        offset = int(request.args.get('offset', 0))
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)

    total = q.count()
    rows = (
        q.order_by(desc(AuditLog.created_at))
        .offset(offset)
        .limit(limit)
        .all()
    )

    return jsonify({
        "total": total,
        "limit": limit,
        "offset": offset,
        "entries": [
            {
                "id": r.id,
                "userId": r.user_id,
                "userEmail": r.user_email,
                "action": r.action,
                "resourceType": r.resource_type,
                "resourceId": r.resource_id,
                "status": r.status,
                "ipAddress": r.ip_address,
                "userAgent": r.user_agent,
                "extra": r.extra_data,
                "createdAt": r.created_at,
            }
            for r in rows
        ],
    })


@bp.route('/actions', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def list_distinct_actions():
    """Return the distinct action names present in the log.

    Used by the admin UI to populate the action filter dropdown without
    hard-coding the (still-growing) list of action names.
    """
    rows = (
        AuditLog.query.with_entities(AuditLog.action)
        .distinct()
        .order_by(AuditLog.action)
        .all()
    )
    return jsonify({"actions": [r[0] for r in rows]})
