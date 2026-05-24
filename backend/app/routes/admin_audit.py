"""Admin-only access to the audit log."""
import csv
import io
import json
from datetime import datetime

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_cors import cross_origin
from sqlalchemy import desc

from flask_jwt_extended import get_jwt_identity

from app.extensions import db
from app.models import AuditLog, User
from app.security.auth import is_super_admin, require_admin
from app.services.audit import log_action

bp = Blueprint("admin_audit", __name__, url_prefix="/api/admin/audit-log")

# Cap how many rows a single page can return so a malicious/buggy client
# can't ask for a million rows and OOM the server.
PAGE_SIZE_MAX = 500
PAGE_SIZE_DEFAULT = 100

# The export endpoint streams every matching row, so it has no page cap — but
# it pulls from the DB in batches of this size to keep memory flat.
EXPORT_BATCH_SIZE = 500

# Filter query params shared by the list and export endpoints.
_FILTER_KEYS = (
    'user_id', 'user_email', 'action', 'resource_type',
    'resource_id', 'status', 'since', 'until',
)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Accept both "Z" and offset suffixes; fromisoformat handles offsets
        # natively in 3.11+.
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _org_scoped(q, actor):
    """Confine an AuditLog query to what `actor` may see: every row for a
    super-admin, else only rows belonging to the actor's own organization.

    Org-less rows (system actions, failed logins for unknown accounts, and
    legacy pre-backfill rows) carry a NULL organization_id and so are visible
    only to super-admins — they aren't attributable to any one org.
    """
    if is_super_admin(actor):
        return q
    return q.filter(AuditLog.organization_id == actor.organization_id)


def _filtered_query(args, actor):
    """Build the AuditLog query from request filters (no ordering/paging),
    confined to the acting admin's organization.

    Shared by the paginated viewer and the export endpoint so both honor the
    exact same filter set *and* the same tenant scope.
    """
    q = _org_scoped(AuditLog.query, actor)

    user_id = args.get('user_id')
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)

    user_email = args.get('user_email')
    if user_email:
        q = q.filter(AuditLog.user_email == user_email)

    action = args.get('action')
    if action:
        q = q.filter(AuditLog.action == action)

    resource_type = args.get('resource_type')
    if resource_type:
        q = q.filter(AuditLog.resource_type == resource_type)

    resource_id = args.get('resource_id')
    if resource_id:
        q = q.filter(AuditLog.resource_id == resource_id)

    status = args.get('status')
    if status:
        q = q.filter(AuditLog.status == status)

    since = _parse_iso(args.get('since'))
    if since:
        q = q.filter(AuditLog.created_at >= since)

    until = _parse_iso(args.get('until'))
    if until:
        q = q.filter(AuditLog.created_at <= until)

    return q


def _active_filters(args) -> dict:
    """The subset of filter params the caller actually supplied — recorded in
    the audit log so a later reviewer sees how the trail was sliced."""
    return {k: args.get(k) for k in _FILTER_KEYS if args.get(k)}


def _serialize_entry(r: AuditLog) -> dict:
    """One audit row as a JSON-ready dict. Used by the viewer and JSON export."""
    return {
        "id": r.id,
        "seq": r.seq,
        "entryHash": r.entry_hash,
        "prevHash": r.prev_hash,
        "userId": r.user_id,
        "userEmail": r.user_email,
        "userRole": r.user_role,
        "action": r.action,
        "resourceType": r.resource_type,
        "resourceId": r.resource_id,
        "status": r.status,
        "ipAddress": r.ip_address,
        "userAgent": r.user_agent,
        "extra": r.extra_data,
        "createdAt": r.created_at,
    }


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
    actor = User.query.get(get_jwt_identity())
    q = _filtered_query(request.args, actor)

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

    # Reviewing the audit log is itself an auditable event: it tells a later
    # reviewer who looked at the trail and with what filters. The actor is
    # resolved from the admin's JWT inside log_action.
    log_action(
        'audit_log.view',
        resource_type='audit_log',
        extra={
            'total': total,
            'limit': limit,
            'offset': offset,
            'filters': _active_filters(request.args),
        },
    )
    db.session.commit()

    return jsonify({
        "total": total,
        "limit": limit,
        "offset": offset,
        "entries": [_serialize_entry(r) for r in rows],
    })


# CSV column order — kept stable so an auditor's tooling can rely on it.
_CSV_COLUMNS = [
    'seq', 'id', 'created_at', 'user_id', 'user_email', 'user_role',
    'action', 'resource_type', 'resource_id', 'status',
    'ip_address', 'user_agent', 'extra_data', 'prev_hash', 'entry_hash',
]


def _csv_row(r: AuditLog) -> list:
    return [
        r.seq if r.seq is not None else '',
        r.id,
        r.created_at.isoformat() if r.created_at else '',
        r.user_id or '',
        r.user_email or '',
        r.user_role or '',
        r.action,
        r.resource_type or '',
        r.resource_id or '',
        r.status,
        r.ip_address or '',
        r.user_agent or '',
        json.dumps(r.extra_data, separators=(',', ':')) if r.extra_data else '',
        r.prev_hash or '',
        r.entry_hash or '',
    ]


def _stream_csv(query):
    """Yield the audit log as CSV, one row at a time.

    Rows come out oldest-first (seq ascending) so the export reads as a
    chronological record and lines up with the hash chain's order.
    """
    buf = io.StringIO()
    writer = csv.writer(buf)

    def flush() -> str:
        out = buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        return out

    writer.writerow(_CSV_COLUMNS)
    yield flush()

    for r in query.order_by(AuditLog.seq.asc(), AuditLog.created_at.asc()).yield_per(EXPORT_BATCH_SIZE):
        writer.writerow(_csv_row(r))
        yield flush()


def _json_default(o):
    if isinstance(o, datetime):
        return o.isoformat()
    return str(o)


def _stream_json(query):
    """Yield the audit log as a JSON array, one entry at a time."""
    yield '['
    first = True
    for r in query.order_by(AuditLog.seq.asc(), AuditLog.created_at.asc()).yield_per(EXPORT_BATCH_SIZE):
        chunk = json.dumps(_serialize_entry(r), default=_json_default)
        yield chunk if first else ',' + chunk
        first = False
    yield ']'


@bp.route('/export', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def export_audit_log():
    """Stream the full filtered audit log as a CSV or JSON download.

    Same filter params as the list endpoint (user_id, user_email, action,
    resource_type, resource_id, status, since, until) — but no pagination:
    every matching row is emitted. Built for an external auditor who needs
    the whole trail in one file instead of paging the JSON API 500 rows at
    a time.

    Query params:
      format — "csv" (default) or "json"
    """
    fmt = (request.args.get('format') or 'csv').strip().lower()
    if fmt not in ('csv', 'json'):
        return jsonify({"error": "format must be 'csv' or 'json'"}), 400

    actor = User.query.get(get_jwt_identity())
    query = _filtered_query(request.args, actor)
    total = query.count()

    # Record the export before the stream opens — it's an auditable disclosure
    # of the whole trail. Committing here also frees the session before the
    # generator below runs its own (read-only) streamed query.
    log_action(
        'audit_log.export',
        resource_type='audit_log',
        extra={
            'total': total,
            'format': fmt,
            'filters': _active_filters(request.args),
        },
    )
    db.session.commit()

    stamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    filename = f"audit-log-{stamp}.{fmt}"

    if fmt == 'csv':
        body = _stream_csv(query)
        mimetype = 'text/csv'
    else:
        body = _stream_json(query)
        mimetype = 'application/json'

    return Response(
        stream_with_context(body),
        mimetype=mimetype,
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'X-Audit-Log-Total': str(total),
        },
    )


@bp.route('/actions', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def list_distinct_actions():
    """Return the distinct action names present in the log.

    Used by the admin UI to populate the action filter dropdown without
    hard-coding the (still-growing) list of action names.
    """
    actor = User.query.get(get_jwt_identity())
    rows = (
        _org_scoped(AuditLog.query, actor)
        .with_entities(AuditLog.action)
        .distinct()
        .order_by(AuditLog.action)
        .all()
    )
    return jsonify({"actions": [r[0] for r in rows]})
