"""Server-side login sessions.

Every successful login creates one `Session` row; the access and refresh
tokens carry its id as a `sid` claim. The per-request guard
(`app/security/auth.py`) validates the row on every call — that is what
makes logout, the idle timeout, and account deactivation take effect
immediately rather than waiting for the JWT to expire on its own.
"""
import uuid
from datetime import datetime

from app.extensions import db


class Session(db.Model):
    __tablename__ = 'user_session'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    # Bumped (throttled) on every authenticated request. The idle-timeout
    # check is simply `now - last_active_at > configured window`.
    last_active_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    revoked = db.Column(db.Boolean, nullable=False, default=False)
    revoked_at = db.Column(db.DateTime, nullable=True)
    # Why the session ended: 'logout' | 'idle_timeout' | 'user_deactivated'
    # | 'admin'. None while the session is still live.
    revoked_reason = db.Column(db.String(32), nullable=True)
    # Best-effort observability for an admin "active sessions" view later.
    ip_address = db.Column(db.String(64), nullable=True)
    user_agent = db.Column(db.String(256), nullable=True)

    def __repr__(self):
        return f"<Session {self.id} user={self.user_id} revoked={self.revoked}>"
