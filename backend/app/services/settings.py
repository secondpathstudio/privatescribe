"""App-wide admin-configurable settings stored in the system_setting table.

Values are JSON-encoded so a single Text column can hold ints, strings, bools,
or small structures. Callers should use the typed accessors (get_int, etc.)
which apply defaults if the row is missing or malformed.
"""
import json
from datetime import datetime, timedelta
from typing import Optional

from app.extensions import db
from app.models import SystemSetting

# Known setting keys. Centralized so frontend and routes stay in sync.
UPLOAD_LIMIT_MB = "upload_limit_mb"
DIARIZATION_DEVICE = "diarization_device"
TRASH_RETENTION_DAYS = "trash_retention_days"
TRASH_AUTO_PURGE = "trash_auto_purge"
LOGOUT_ON_CLOSE = "logout_on_close"
TWO_FACTOR_REQUIRED = "two_factor_required"
EXPORTS_ENABLED = "exports_enabled"
DICTATION_MARKERS_ENABLED = "dictation_markers_enabled"
VOCABULARY_TERMS = "vocabulary_terms"
ABBREVIATIONS = "abbreviations"
WHISPER_MODEL = "whisper_model"

DEFAULT_UPLOAD_LIMIT_MB = 500
MIN_UPLOAD_LIMIT_MB = 1
MAX_UPLOAD_LIMIT_MB = 5120  # 5 GB — generous, but blocks "infinite upload" footguns

DEFAULT_DIARIZATION_DEVICE = "auto"

# faster-whisper model size used for transcription. "base" matches the
# original hardcoded value, so an unset row keeps pre-feature behavior.
# The admin can switch to a larger model from the Transcription settings
# page (which downloads the weights first — see services/whisper_manager).
DEFAULT_WHISPER_MODEL = "base"

# Trash retention. A soft-deleted note/template must sit in the trash at least
# this many days before it can be permanently deleted — manually or by the
# `flask purge-trash` job. 0 = no waiting period (delete anytime). The max is
# ~10 years, comfortably covering the longest clinical/legal record-retention
# windows we expect anyone to need.
DEFAULT_TRASH_RETENTION_DAYS = 30
MIN_TRASH_RETENTION_DAYS = 0
MAX_TRASH_RETENTION_DAYS = 3650

# When True, `flask purge-trash` hard-deletes trashed items older than the
# retention window. When False (default), nothing is auto-deleted — items stay
# in the trash until someone permanently deletes them by hand.
DEFAULT_TRASH_AUTO_PURGE = False

# When True, the Electron shell clears stored auth tokens on app launch so
# the user has to re-authenticate every time they reopen the app. Web
# clients ignore this flag — they manage their own sessions.
DEFAULT_LOGOUT_ON_CLOSE = True

# When True, every user must complete a TOTP code challenge after password
# auth. Users who aren't yet enrolled get pushed through enrollment as part
# of their next login. Flipping this off doesn't wipe stored secrets — it
# just stops the challenge, so flipping it back on doesn't force re-enroll.
DEFAULT_TWO_FACTOR_REQUIRED = False

# When True, users can download their notes as PDF / DOCX. Admins flip this
# off to broadly disable document exports — both endpoints return 503 and the
# UI hides the download buttons.
DEFAULT_EXPORTS_ENABLED = True

# When True, the transcribe route post-processes Whisper output to honor
# spoken dictation commands ("new paragraph", "new section", "new line").
# See services/dictation_markers.py.
DEFAULT_DICTATION_MARKERS_ENABLED = True

# Admin-wide defaults for vocabulary and abbreviations. Both are empty by
# default — the feature only kicks in when an admin or user actually
# populates a list. Stored JSON-encoded under their respective keys.
DEFAULT_VOCABULARY_TERMS: list[str] = []
DEFAULT_ABBREVIATIONS: dict[str, str] = {}


def _get_raw(key: str) -> Optional[str]:
    row = db.session.get(SystemSetting, key)
    return row.value if row else None


def get_int(key: str, default: int) -> int:
    raw = _get_raw(key)
    if raw is None:
        return default
    try:
        value = json.loads(raw)
        return int(value)
    except (ValueError, TypeError, json.JSONDecodeError):
        return default


def get_str(key: str, default: str) -> str:
    raw = _get_raw(key)
    if raw is None:
        return default
    try:
        value = json.loads(raw)
        if isinstance(value, str):
            return value
        return default
    except (ValueError, TypeError, json.JSONDecodeError):
        return default


def get_bool(key: str, default: bool) -> bool:
    raw = _get_raw(key)
    if raw is None:
        return default
    try:
        value = json.loads(raw)
        if isinstance(value, bool):
            return value
        return default
    except (ValueError, TypeError, json.JSONDecodeError):
        return default


def set_value(key: str, value, updated_by: Optional[str] = None) -> None:
    """Upsert a setting. `value` is JSON-serialized."""
    serialized = json.dumps(value)
    row = db.session.get(SystemSetting, key)
    if row is None:
        row = SystemSetting(key=key, value=serialized, updated_by=updated_by)
        db.session.add(row)
    else:
        row.value = serialized
        row.updated_at = datetime.utcnow()
        row.updated_by = updated_by
    db.session.commit()


def get_upload_limit_mb() -> int:
    return get_int(UPLOAD_LIMIT_MB, DEFAULT_UPLOAD_LIMIT_MB)


def get_diarization_device() -> str:
    return get_str(DIARIZATION_DEVICE, DEFAULT_DIARIZATION_DEVICE)


def get_whisper_model() -> str:
    return get_str(WHISPER_MODEL, DEFAULT_WHISPER_MODEL)


def get_trash_retention_days() -> int:
    value = get_int(TRASH_RETENTION_DAYS, DEFAULT_TRASH_RETENTION_DAYS)
    # Clamp defensively — a bad row shouldn't make the floor negative or absurd.
    return max(MIN_TRASH_RETENTION_DAYS, min(MAX_TRASH_RETENTION_DAYS, value))


def get_trash_auto_purge() -> bool:
    return get_bool(TRASH_AUTO_PURGE, DEFAULT_TRASH_AUTO_PURGE)


def get_logout_on_close() -> bool:
    return get_bool(LOGOUT_ON_CLOSE, DEFAULT_LOGOUT_ON_CLOSE)


def get_two_factor_required() -> bool:
    return get_bool(TWO_FACTOR_REQUIRED, DEFAULT_TWO_FACTOR_REQUIRED)


def get_exports_enabled() -> bool:
    return get_bool(EXPORTS_ENABLED, DEFAULT_EXPORTS_ENABLED)


def get_dictation_markers_enabled() -> bool:
    return get_bool(DICTATION_MARKERS_ENABLED, DEFAULT_DICTATION_MARKERS_ENABLED)


def get_admin_vocabulary_terms() -> list[str]:
    """Admin-wide vocabulary list. Returns [] if unset or malformed."""
    raw = _get_raw(VOCABULARY_TERMS)
    if raw is None:
        return list(DEFAULT_VOCABULARY_TERMS)
    try:
        value = json.loads(raw)
        if isinstance(value, list):
            return [str(v) for v in value if isinstance(v, str) and v.strip()]
        return list(DEFAULT_VOCABULARY_TERMS)
    except (ValueError, TypeError, json.JSONDecodeError):
        return list(DEFAULT_VOCABULARY_TERMS)


def get_admin_abbreviations() -> dict[str, str]:
    """Admin-wide abbreviation map. Returns {} if unset or malformed."""
    raw = _get_raw(ABBREVIATIONS)
    if raw is None:
        return dict(DEFAULT_ABBREVIATIONS)
    try:
        value = json.loads(raw)
        if isinstance(value, dict):
            return {str(k): str(v) for k, v in value.items()
                    if isinstance(k, str) and isinstance(v, str) and k.strip()}
        return dict(DEFAULT_ABBREVIATIONS)
    except (ValueError, TypeError, json.JSONDecodeError):
        return dict(DEFAULT_ABBREVIATIONS)


def trash_purge_eligible_on(is_deleted_timestamp: Optional[datetime]) -> Optional[datetime]:
    """UTC datetime at which a soft-deleted item becomes eligible for permanent
    deletion, or None if there's no waiting period (retention == 0) or the
    deletion timestamp is missing (treated as 'eligible now').
    """
    days = get_trash_retention_days()
    if days <= 0 or is_deleted_timestamp is None:
        return None
    return is_deleted_timestamp + timedelta(days=days)


def trash_purge_block_reason(is_deleted_timestamp: Optional[datetime], *, noun: str = "item") -> Optional[str]:
    """Human-readable reason this item can't be permanently deleted yet, or
    None if it's eligible now. Used by the permanent-delete routes and the
    purge job to speak with one voice.
    """
    eligible_on = trash_purge_eligible_on(is_deleted_timestamp)
    if eligible_on is None or datetime.utcnow() >= eligible_on:
        return None
    return (
        f"This {noun} can't be permanently deleted yet — the trash retention "
        f"policy keeps it until {eligible_on.strftime('%m/%d/%Y')} "
        f"({get_trash_retention_days()} days after it entered the trash)."
    )
