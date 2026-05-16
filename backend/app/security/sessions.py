"""Server-side session lifecycle.

A `Session` row is the source of truth for whether a login is still good.
Logout, the idle timeout, and account deactivation all work by revoking the
row; the per-request guard in `app/security/auth.py` checks it on every call.

These are plain helpers — persistence (`db.session.commit()`) is the caller's
responsibility, except where noted.
"""
from datetime import datetime, timedelta
from typing import Optional

from flask import request

from app.extensions import db
from app.models.session import Session
from app.services import settings as settings_service

# last_active_at is not written on every request — once per this many seconds
# is plenty for an idle window measured in minutes, and it keeps read-heavy
# request bursts from each triggering a write.
_TOUCH_THROTTLE_SECONDS = 60


def start_session(user_id: str) -> Session:
    """Create a fresh session row for a successful login. Flushed so the
    caller can read `.id` for the token claim; commit is the caller's job."""
    session = Session(
        user_id=user_id,
        ip_address=request.remote_addr if request else None,
        user_agent=(request.user_agent.string[:256]
                    if request and request.user_agent else None),
    )
    db.session.add(session)
    db.session.flush()
    return session


def get_session(sid: Optional[str]) -> Optional[Session]:
    if not sid:
        return None
    return db.session.get(Session, sid)


def revoke_session(session: Session, reason: str) -> None:
    """Mark a single session revoked. No-op if already revoked."""
    if session.revoked:
        return
    session.revoked = True
    session.revoked_at = datetime.utcnow()
    session.revoked_reason = reason


def revoke_user_sessions(user_id: str, reason: str) -> int:
    """Revoke every live session for a user. Returns how many were revoked.
    Used for off-boarding (deactivation)."""
    live = Session.query.filter_by(user_id=user_id, revoked=False).all()
    now = datetime.utcnow()
    for s in live:
        s.revoked = True
        s.revoked_at = now
        s.revoked_reason = reason
    return len(live)


def is_idle_expired(session: Session) -> bool:
    """True when the session has gone idle past the admin-configured window.
    Always False when the timeout is disabled (0)."""
    minutes = settings_service.get_session_idle_timeout_minutes()
    if minutes <= 0:
        return False
    return datetime.utcnow() - session.last_active_at > timedelta(minutes=minutes)


def touch(session: Session) -> bool:
    """Record activity by bumping last_active_at, throttled. Returns True when
    it actually wrote (so the caller knows whether a commit is needed)."""
    now = datetime.utcnow()
    if (now - session.last_active_at).total_seconds() >= _TOUCH_THROTTLE_SECONDS:
        session.last_active_at = now
        return True
    return False
