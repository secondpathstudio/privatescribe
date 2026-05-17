"""Audit-log retention — archive expired rows to disk, then purge them.

Audit rows are append-only and tamper-evident: each row is HMAC-linked to the
one before it (see app.services.audit). They are therefore never silently
deleted. `archive_and_purge()` instead:

  1. selects rows older than the admin-configured retention window,
  2. writes them — hashes and all — to a JSON archive file on disk,
  3. deletes them from the table (lifting the append-only DELETE guard only
     for that bracketed window),
  4. advances a watermark recording the last archived seq + entry_hash, so the
     remaining hash chain still verifies and new rows keep chaining cleanly.

Only a contiguous prefix of the chain is ever purged — deleting a row from the
middle would break the hash linkage of everything after it.

The archive file is itself chain-verifiable: it carries each row's
prev_hash/entry_hash, and its final chained row's entry_hash equals the
watermark. Driven by `flask purge-audit-log`, intended to run on a schedule
alongside `purge-trash` / `purge-audio`.
"""
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path

from app.extensions import db
from app.models import AuditLog
from app.paths import data_dir
from app.services import audit, settings as settings_service

logger = logging.getLogger(__name__)

# Schema tag written into every archive file, so a future reader can branch on
# the layout if it ever changes.
ARCHIVE_SCHEMA = "privatescribe-audit-archive/1"


def archive_dir() -> Path:
    """Directory holding the audit-log JSON archive files. Created on demand."""
    d = data_dir() / "audit-archives"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _row_dict(r: AuditLog) -> dict:
    """One audit row as a JSON-ready dict — every column, hashes included, so
    the archive file stands on its own as a verifiable record."""
    return {
        "id": r.id,
        "seq": r.seq,
        "prev_hash": r.prev_hash,
        "entry_hash": r.entry_hash,
        "user_id": r.user_id,
        "user_email": r.user_email,
        "user_role": r.user_role,
        "action": r.action,
        "resource_type": r.resource_type,
        "resource_id": r.resource_id,
        "status": r.status,
        "ip_address": r.ip_address,
        "user_agent": r.user_agent,
        "extra_data": r.extra_data,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _write_archive(rows: list[AuditLog]) -> Path:
    """Write `rows` to a timestamped JSON archive file and return its path.

    Written tmp-then-rename so a crash mid-write never leaves a partial file
    that could be mistaken for a complete archive, and chmod 600 because the
    rows can carry PHI-adjacent context (emails, IPs, resource ids).
    """
    first, last = rows[0].seq, rows[-1].seq
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    path = archive_dir() / f"audit-archive-seq{first}-{last}-{stamp}.json"
    payload = {
        "schema": ARCHIVE_SCHEMA,
        "archived_at": datetime.utcnow().isoformat() + "Z",
        "row_count": len(rows),
        "seq_range": [first, last],
        "rows": [_row_dict(r) for r in rows],
    }
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, default=str))
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(path)
    return path


def _advance_watermark(rows: list[AuditLog], archive_path: Path) -> None:
    """Record the highest archived row so the live chain stays verifiable.

    `entry_hash` is the hash of the highest archived row that has one — legacy
    pre-chain rows carry none, so a purge confined to them leaves entry_hash
    null and the live chain still starts from the genesis sentinel.
    """
    last_hash = next((r.entry_hash for r in reversed(rows) if r.entry_hash), None)
    prev = settings_service.get_audit_archive_watermark() or {}
    watermark = {
        "seq": rows[-1].seq,
        "entry_hash": last_hash,
        "archived_at": datetime.utcnow().isoformat() + "Z",
        "total_archived": (prev.get("total_archived") or 0) + len(rows),
        "last_archive_file": archive_path.name,
    }
    # set_value commits — which also commits the pending row deletes.
    settings_service.set_value(settings_service.AUDIT_ARCHIVE_WATERMARK, watermark)


def archive_and_purge(*, dry_run: bool = False) -> dict:
    """Archive then delete audit rows past the retention window.

    Returns a summary dict: retention_days, cutoff, eligible_count, seq_range,
    archive_file, purged, dry_run, and (when applicable) disabled /
    non_contiguous_skipped. A no-op summary (eligible_count 0) is returned when
    retention is disabled or nothing is old enough.
    """
    retention_days = settings_service.get_audit_retention_days()
    summary: dict = {
        "retention_days": retention_days,
        "cutoff": None,
        "eligible_count": 0,
        "seq_range": None,
        "archive_file": None,
        "purged": False,
        "dry_run": dry_run,
    }
    if retention_days <= 0:
        summary["disabled"] = True
        return summary

    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    summary["cutoff"] = cutoff.isoformat()

    candidates = (
        AuditLog.query
        .filter(AuditLog.created_at <= cutoff)
        .order_by(AuditLog.seq.asc())
        .all()
    )
    if not candidates:
        return summary

    # Purge only a contiguous prefix of the chain: start one past the current
    # watermark and walk while seq stays consecutive. created_at and seq are
    # normally monotonic together, but this guards against clock skew putting
    # an older-stamped row mid-chain.
    watermark = settings_service.get_audit_archive_watermark() or {}
    expected = (watermark.get("seq") or 0) + 1
    rows: list[AuditLog] = []
    for r in candidates:
        if r.seq != expected:
            break
        rows.append(r)
        expected += 1
    if len(rows) != len(candidates):
        summary["non_contiguous_skipped"] = len(candidates) - len(rows)
    if not rows:
        return summary

    summary["eligible_count"] = len(rows)
    summary["seq_range"] = [rows[0].seq, rows[-1].seq]

    if dry_run:
        return summary

    # Archive to disk first — only delete once the rows are safely on disk.
    archive_path = _write_archive(rows)
    summary["archive_file"] = str(archive_path)

    # Delete inside the bracketed window so the DELETEs execute while the
    # append-only guard is lifted; flush forces them out before the guard
    # is restored on block exit.
    with audit.audit_delete_window():
        for r in rows:
            db.session.delete(r)
        db.session.flush()

    _advance_watermark(rows, archive_path)  # commits the deletes + watermark

    # Record the purge itself — it lands in the now-trimmed chain, numbered
    # one past the watermark, so the trail documents its own pruning.
    audit.log_action(
        'audit_log.archive_purge',
        resource_type='audit_log',
        extra={
            'archived_count': len(rows),
            'seq_range': summary["seq_range"],
            'archive_file': archive_path.name,
            'retention_days': retention_days,
            'via': 'purge-audit-log',
        },
    )
    db.session.commit()

    summary["purged"] = True
    logger.info(
        f"[audit-retention] archived {len(rows)} row(s) "
        f"(seq {summary['seq_range'][0]}-{summary['seq_range'][1]}) to {archive_path}"
    )
    return summary
