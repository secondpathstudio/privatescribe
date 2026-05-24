"""Audit log helpers.

Route handlers call log_action(...) to record a single user-facing action.
The helper pulls request-scoped context (IP, user agent) from Flask's
`request` and resolves the acting user from the JWT identity when one is
present, so callers only need to pass the action and any action-specific
details.

Failures inside log_action are swallowed (and logged) and never propagate
back to the caller — an audit-table write failing should not 500 the
underlying request, but it should be visible in the server log so it can
be diagnosed.
"""
import hashlib
import hmac
import json
import logging
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Mapping

from flask import has_request_context, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, text

from app.extensions import db
from app.models import AuditLog, User
from app.services import settings as settings_service

logger = logging.getLogger(__name__)


# Max length of the User-Agent column. Browsers send 100-200 char UAs but a
# malicious client can send much more — truncate so a giant header can't
# bloat the table.
_USER_AGENT_MAX = 512


# --- Tamper-evidence: HMAC hash chain -------------------------------------
#
# Every audit row is linked to the one before it: entry_hash = HMAC(key,
# prev_hash || canonical(row)). Editing or deleting a row makes the chain
# stop verifying. The key is AUDIT_HMAC_KEY — distinct from the SQLCipher
# DB key and never exposed by any API — so an admin who can open the DB
# still cannot forge a valid hash.

# prev_hash of the very first chained row. 64 zero hex chars so it's the
# same width as a real SHA-256 digest.
_GENESIS = "0" * 64

# Tables that are append-only and get UPDATE/DELETE-blocking DB triggers.
_AUDIT_TABLES = ("audit_log", "key_export_log")

# Installed once at startup by configure(). When None the chain is disabled
# and rows are written unchained — log_action still works.
_hmac_key: str | None = None


def configure(hmac_key: str | None) -> None:
    """Install the audit-log HMAC key. Called once from create_app()."""
    global _hmac_key
    _hmac_key = hmac_key or None


def _chain_fields(entry: AuditLog) -> dict[str, Any]:
    """The subset of an audit row that its entry_hash commits to.

    Excludes prev_hash (mixed in separately) and entry_hash (the output).
    Every field here is immutable once the row is written, so the hash is
    stable for the life of the row.
    """
    return {
        "seq": entry.seq,
        "id": entry.id,
        "user_id": entry.user_id,
        "user_email": entry.user_email,
        "user_role": entry.user_role,
        "action": entry.action,
        "resource_type": entry.resource_type,
        "resource_id": entry.resource_id,
        "status": entry.status,
        "ip_address": entry.ip_address,
        "user_agent": entry.user_agent,
        "extra_data": entry.extra_data,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


def _entry_hash(prev_hash: str, fields: Mapping[str, Any]) -> str:
    """HMAC-SHA256 over prev_hash joined with the canonical row encoding."""
    canonical = json.dumps(fields, sort_keys=True, separators=(",", ":"), default=str)
    msg = f"{prev_hash}\n{canonical}".encode("utf-8")
    return hmac.new(_hmac_key.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _chain_entry(entry: AuditLog, extra_data: dict[str, Any]) -> None:
    """Assign seq + prev_hash to a new row and flag any detected break.

    Does NOT set entry_hash: the caller finalizes extra_data first (this
    function may add a 'chain_broken' marker to it) and then hashes the
    completed row. A no-op when the chain is disabled.
    """
    if not _hmac_key:
        return

    # A retention purge can archive-and-delete the chain's oldest rows; the
    # watermark holds the last archived row's seq + entry_hash so numbering
    # and linkage continue uninterrupted even when the table is now empty.
    watermark = settings_service.get_audit_archive_watermark() or {}
    wm_seq = watermark.get("seq") or 0

    db_max_seq = db.session.query(func.max(AuditLog.seq)).scalar() or 0
    entry.seq = max(db_max_seq, wm_seq) + 1

    last = (
        AuditLog.query
        .filter(AuditLog.entry_hash.isnot(None))
        .order_by(AuditLog.seq.desc())
        .first()
    )
    if last is None:
        # No chained row left in the table — either the chain hasn't started
        # or every chained row has been archived away. Link off the watermark
        # hash when one exists, else the genesis sentinel.
        entry.prev_hash = watermark.get("entry_hash") or _GENESIS
        return

    entry.prev_hash = last.entry_hash

    # Cheap integrity check on the immediate predecessor: recompute its hash
    # and compare. A mismatch means that row was edited after it was written.
    # Policy is continue-and-mark — we still record this row, chained off the
    # (possibly tampered) stored hash, but flag the break inline so it's
    # visible without a full `flask verify-audit-log` sweep.
    recomputed = _entry_hash(last.prev_hash or _GENESIS, _chain_fields(last))
    if not hmac.compare_digest(recomputed, last.entry_hash or ""):
        logger.error(
            f"[audit] hash-chain break: predecessor seq={last.seq} id={last.id} "
            f"fails verification; flagging new row seq={entry.seq}"
        )
        extra_data["chain_broken"] = {
            "predecessor_seq": last.seq,
            "predecessor_id": last.id,
            "detected_at_seq": entry.seq,
        }


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
    organization_id: str | None = None,
) -> None:
    """Record one audit log row.

    All fields except `action` are optional. Request context (IP, UA) is
    captured automatically when called from inside a Flask request. The audit
    row is added inside a SAVEPOINT — the caller's own pending work is flushed
    first — so a failed audit write rolls back only the audit row and never
    the caller's transaction.

    `organization_id` overrides the org this row is attributed to. Normally it
    is left None and `services/org_stamp.py` stamps it from the actor; pass it
    explicitly when the row belongs to a *different* org than the actor — e.g.
    a super-admin's cross-org break-glass should be attributed to the target's
    org so that org's admin sees it in their scoped audit viewer.
    """
    try:
        ip = None
        ua = None
        if has_request_context():
            ip = request.remote_addr
            ua_header = request.headers.get('User-Agent')
            if ua_header:
                ua = ua_header[:_USER_AGENT_MAX]

        # Flush the caller's own pending work into the transaction first, so
        # the SAVEPOINT below brackets nothing but the audit row.
        db.session.flush()

        # The actor lookup and the audit INSERT run inside a SAVEPOINT.
        # begin_nested() flushes and releases the savepoint on a clean exit;
        # on any exception it rolls back to the savepoint *only*. So a failed
        # audit write undoes nothing but the audit row — the caller's pending
        # work (flushed above) and their later commit are unaffected.
        with db.session.begin_nested():
            user_id, user_email, user_role = _resolve_actor(user_id, user_email)

            # Cast resource_id to str so callers don't have to remember — most
            # of the app uses string UUIDs but some legacy integer IDs sneak in.
            rid = str(resource_id) if resource_id is not None else None

            extra_data = dict(extra) if extra else {}

            # id and created_at are set explicitly (not left to column
            # defaults, which apply only at flush) so both are known before
            # the row is hashed.
            entry = AuditLog(
                id=str(uuid.uuid4()),
                user_id=user_id,
                user_email=user_email,
                user_role=user_role,
                action=action,
                resource_type=resource_type,
                resource_id=rid,
                status=status,
                ip_address=ip,
                user_agent=ua,
                created_at=datetime.utcnow(),
                # When given, attributes the row to a specific org (e.g. a
                # break-glass target). When None, org_stamp fills it from the
                # actor at insert. Not part of the hash chain (_chain_fields).
                organization_id=organization_id,
            )

            # Assign seq/prev_hash and let _chain_entry append a chain_broken
            # marker to extra_data if the predecessor fails verification.
            _chain_entry(entry, extra_data)
            entry.extra_data = extra_data or None

            # Hash last, over the now-final row (including any chain_broken
            # marker just added to extra_data).
            if _hmac_key:
                entry.entry_hash = _entry_hash(entry.prev_hash, _chain_fields(entry))

            db.session.add(entry)
    except Exception as e:
        # Audit logging must never break the underlying request, so swallow
        # and just record it. A failure inside the SAVEPOINT rolled back only
        # the audit row; a failure in the flush above is the caller's own bad
        # data surfacing — either way we don't re-raise.
        logger.error(
            f"[audit] failed to log action={action!r}: {type(e).__name__}: {e}"
        )


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


def verify_chain() -> dict[str, Any]:
    """Walk the audit-log hash chain and report any tampering.

    Returns {ok, total, chained, legacy, archived, issues}. `ok` is False when
    the HMAC key is missing or any issue is found. Backs `flask
    verify-audit-log`.

    Three classes of tampering are caught:
      - content edit  — a row's recomputed entry_hash no longer matches
      - row deletion  — a gap in the seq sequence, or a prev_hash that no
                        longer chains to the preceding row
      - row insertion — same prev_hash break, from the other direction

    Rows trimmed by a retention purge are NOT treated as deletions: the
    archival watermark records the last archived seq + entry_hash, so the
    live trail is expected to resume one past it and chain off that hash.
    The archived rows themselves live in the JSON archive files.
    """
    if not _hmac_key:
        return {
            "ok": False, "total": 0, "chained": 0, "legacy": 0, "archived": 0,
            "issues": ["AUDIT_HMAC_KEY is not configured — chain cannot be verified"],
        }

    watermark = settings_service.get_audit_archive_watermark() or {}

    rows = (
        AuditLog.query
        .filter(AuditLog.seq.isnot(None))
        .order_by(AuditLog.seq.asc())
        .all()
    )
    issues: list[str] = []
    chained = [r for r in rows if r.entry_hash is not None]
    legacy = [r for r in rows if r.entry_hash is None]

    # seq contiguity — a gap means a row was deleted.
    seqs = [r.seq for r in rows]
    for prev, cur in zip(seqs, seqs[1:]):
        if cur != prev + 1:
            issues.append(
                f"seq gap between {prev} and {cur} — {cur - prev - 1} row(s) deleted"
            )

    # The live trail must resume exactly one past the archival watermark.
    # A larger gap means rows vanished between the archive and the table.
    wm_seq = watermark.get("seq")
    if isinstance(wm_seq, int) and rows and rows[0].seq != wm_seq + 1:
        issues.append(
            f"seq gap after archival watermark {wm_seq} — live trail starts "
            f"at {rows[0].seq}, {rows[0].seq - wm_seq - 1} row(s) missing"
        )

    # Hash chain — recompute each row and confirm it links to its predecessor.
    # The first live row chains off the watermark hash when a purge has run.
    expected_prev = watermark.get("entry_hash") or _GENESIS
    for r in chained:
        recomputed = _entry_hash(r.prev_hash or _GENESIS, _chain_fields(r))
        if not hmac.compare_digest(recomputed, r.entry_hash or ""):
            issues.append(
                f"row seq={r.seq} id={r.id}: content tampered (entry_hash mismatch)"
            )
        if (r.prev_hash or "") != expected_prev:
            issues.append(
                f"row seq={r.seq} id={r.id}: prev_hash does not chain to the "
                f"preceding row (insertion/deletion)"
            )
        expected_prev = r.entry_hash

    return {
        "ok": not issues,
        "total": len(rows),
        "chained": len(chained),
        "legacy": len(legacy),
        "archived": watermark.get("total_archived") or 0,
        "issues": issues,
    }


@contextmanager
def audit_delete_window():
    """Temporarily lift the DELETE guard on the audit_log table.

    audit_log carries a BEFORE DELETE trigger that aborts every delete (see
    ensure_audit_triggers). Retention archival is the one sanctioned path that
    removes rows — and only after writing them to a JSON archive file — so it
    drops the trigger for the duration of the delete and restores it
    immediately after, even on error.

    Callers MUST flush the deletes inside the `with` block: once the block
    exits the trigger is back, and any DELETE issued later (e.g. at commit)
    would abort. The trigger DROP/CREATE ride in the caller's transaction, so
    a rollback restores the original guarded state.
    """
    db.session.execute(text("DROP TRIGGER IF EXISTS audit_log_no_delete"))
    try:
        yield
    finally:
        db.session.execute(text(
            "CREATE TRIGGER IF NOT EXISTS audit_log_no_delete "
            "BEFORE DELETE ON audit_log "
            "BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END"
        ))


def ensure_audit_triggers() -> None:
    """Install DB triggers rejecting UPDATE/DELETE on the append-only tables.

    Defense-in-depth: application code only ever INSERTs into audit_log and
    key_export_log, so these triggers never fire in normal use — they stop
    accidental or casual tampering (an ORM bug, a stray UPDATE in a console).
    They are not a hard control: anyone with the raw SQLCipher key can DROP
    them, which is why the HMAC chain is the primary safeguard.

    Idempotent (CREATE TRIGGER IF NOT EXISTS); called from create_app() so a
    fresh DB coming up via db.create_all() is covered too.
    """
    for table in _AUDIT_TABLES:
        for op_kind in ("UPDATE", "DELETE"):
            name = f"{table}_no_{op_kind.lower()}"
            db.session.execute(text(
                f"CREATE TRIGGER IF NOT EXISTS {name} "
                f"BEFORE {op_kind} ON {table} "
                f"BEGIN SELECT RAISE(ABORT, '{table} is append-only'); END"
            ))
    db.session.commit()
