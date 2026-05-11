"""Audit log: append-only record of user-facing actions.

Every mutating endpoint and selected read endpoints write one row here so
admins can answer "who did what, when, from where?" — including failed
logins where no user row exists yet.

Rows are never updated or deleted from application code; admins inspect
via /api/admin/audit-log.
"""
import uuid
from datetime import datetime

from app.extensions import db


class AuditLog(db.Model):
    __tablename__ = 'audit_log'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # user_id is nullable so failed logins (where the email may not match any
    # user) and pre-auth events can still be recorded. user_email is stored
    # denormalized so the log stays readable even if the user is later deleted.
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=True, index=True)
    user_email = db.Column(db.String(255), nullable=True)

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

    def __repr__(self):
        return f"<AuditLog {self.action} user={self.user_email} at={self.created_at}>"
