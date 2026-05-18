"""Per-account brute-force lockout (GAP-03).

The per-IP rate limiter (app/extensions.py) is a coarse throttle that resets on
every backend restart and is bypassable by IP rotation. This module is the
durable backstop: it counts consecutive failed password attempts *per account*
in the encrypted DB, and locks the account for a fixed window once the count
crosses an admin-configured threshold.

None of these helpers commit — the calling route/CLI owns the transaction, so
the lockout state lands in the same commit as the audit-log row.
"""
from datetime import datetime, timedelta
from typing import Optional

from app.services import settings as settings_service


def is_enabled() -> bool:
    """False when the admin has set the threshold to 0 — lockout is off and
    the per-IP rate limit is the only brake."""
    return settings_service.get_account_lockout_threshold() > 0


def is_locked(user) -> bool:
    """True when this account currently holds an unexpired lock."""
    return user.locked_until is not None and user.locked_until > datetime.utcnow()


def lockout_message(user) -> str:
    """Human-readable 'try again later' message for a locked account. Rounds
    up to whole minutes so the user is never told to wait '0 minutes'."""
    remaining = user.locked_until - datetime.utcnow()
    minutes = max(1, -(-int(remaining.total_seconds()) // 60))
    unit = "minute" if minutes == 1 else "minutes"
    return (
        "This account is temporarily locked after too many failed sign-in "
        f"attempts. Try again in about {minutes} {unit}, or contact an "
        "administrator."
    )


def register_failure(user) -> bool:
    """Record one failed password attempt. Returns True if this attempt is the
    one that crossed the threshold and locked the account.

    On lock the counter resets to 0 so that, once the window passes, the
    account gets a fresh set of attempts rather than re-locking on the first
    post-expiry miss."""
    threshold = settings_service.get_account_lockout_threshold()
    user.failed_login_count = (user.failed_login_count or 0) + 1

    if threshold > 0 and user.failed_login_count >= threshold:
        minutes = settings_service.get_account_lockout_minutes()
        user.locked_until = datetime.utcnow() + timedelta(minutes=minutes)
        user.failed_login_count = 0
        return True
    return False


def register_success(user) -> None:
    """Clear the failure counter and any lock after a successful login."""
    user.failed_login_count = 0
    user.locked_until = None


def unlock(user) -> bool:
    """Clear a lock and the failure counter (admin unlock / CLI break-glass).
    Returns True if the account had a counter or lock to clear."""
    had_state = bool(user.failed_login_count) or user.locked_until is not None
    user.failed_login_count = 0
    user.locked_until = None
    return had_state
