"""Audit log: append-only record of user-facing actions.

Every mutating endpoint and selected read endpoints write one row here so
admins can answer "who did what, when, from where?" — including failed
logins where no user row exists yet.

Rows are never updated or deleted from application code; admins inspect
via /api/admin/audit-log. DB triggers (see app.services.audit) also reject
UPDATE/DELETE at the database layer.

Tamper-evidence: each row carries `seq`, `prev_hash`, and `entry_hash`,
forming an HMAC hash chain (keyed by AUDIT_HMAC_KEY). Editing or deleting
a row breaks the chain and is detectable via `flask verify-audit-log`.
The chain logic lives in app.services.audit.
"""
import uuid
from datetime import datetime

from app.extensions import db


class AuditLog(db.Model):
    __tablename__ = 'audit_log'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # user_id is nullable so failed logins (where the email may not match any
    # user) and pre-auth events can still be recorded. user_email and user_role
    # are stored denormalized: email so the log stays readable even if the
    # user is later deleted; role so the log reflects the user's privilege
    # *at the time of the action*, not whatever their role is when an admin
    # later reviews the log.
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=True, index=True)
    user_email = db.Column(db.String(255), nullable=True)
    user_role = db.Column(db.String(32), nullable=True)

    # Dot-namespaced action key, e.g. "note.create", "auth.login_failed".
    action = db.Column(db.String(64), nullable=False, index=True)

    resource_type = db.Column(db.String(32), nullable=True, index=True)
    resource_id = db.Column(db.String(64), nullable=True, index=True)

    # "success" | "failure" — most rows are success; failure rows carry the
    # reason in extra_data.
    status = db.Column(db.String(16), nullable=False, default='success')

    ip_address = db.Column(db.String(64), nullable=True)
    user_agent = db.Column(db.String(512), nullable=True)

    # Free-form JSON payload: field diffs for edits, attempted email for
    # failed logins, query params for list views, etc. Kept as JSON so the
    # admin UI can render it without a schema change per new action.
    extra_data = db.Column(db.JSON, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)

    # --- Tamper-evidence: HMAC hash chain ---
    # seq: strictly increasing chain position. Rows that predate the chain
    # are backfilled with a seq (so ordering is stable) but keep prev_hash
    # and entry_hash NULL — they are "legacy, unchained" and cannot be
    # protected retroactively.
    seq = db.Column(db.Integer, nullable=True, unique=True, index=True)
    # prev_hash: the entry_hash of the previous chained row (or a fixed
    # genesis sentinel for the first chained row). entry_hash: HMAC-SHA256
    # over this row's content joined with prev_hash, keyed by AUDIT_HMAC_KEY.
    # Because that key is never exposed by any API, an admin holding only the
    # DB key cannot recompute a valid entry_hash after editing a row.
    prev_hash = db.Column(db.String(64), nullable=True)
    entry_hash = db.Column(db.String(64), nullable=True)

    def __repr__(self):
        return f"<AuditLog {self.action} user={self.user_email} at={self.created_at}>"
