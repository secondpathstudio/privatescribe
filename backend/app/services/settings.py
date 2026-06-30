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
APPEND_RECORDING_ENABLED = "append_recording_enabled"
VOCABULARY_TERMS = "vocabulary_terms"
ABBREVIATIONS = "abbreviations"
WHISPER_MODEL = "whisper_model"
AUDIO_STORAGE_ENABLED = "audio_storage_enabled"
AUDIO_RETENTION_DAYS = "audio_retention_days"
ORPHANED_AUDIO_PURGE = "orphaned_audio_purge"
SESSION_IDLE_TIMEOUT_MINUTES = "session_idle_timeout_minutes"
ONBOARDING_COMPLETED = "onboarding_completed"
LLM_MODEL = "llm_model"
PASSWORD_POLICY = "password_policy"
AUDIT_RETENTION_DAYS = "audit_retention_days"
AUDIT_AUTO_PURGE = "audit_auto_purge"
BACKUP_RETENTION_DAYS = "backup_retention_days"
LAST_BACKUP_AT = "last_backup_at"
AUDIT_ARCHIVE_WATERMARK = "audit_archive_watermark"
ACCOUNT_LOCKOUT_THRESHOLD = "account_lockout_threshold"
ACCOUNT_LOCKOUT_MINUTES = "account_lockout_minutes"
NO_LOGIN_MODE = "no_login_mode"
NO_LOGIN_USER_ID = "no_login_user_id"

DEFAULT_UPLOAD_LIMIT_MB = 500
MIN_UPLOAD_LIMIT_MB = 1
MAX_UPLOAD_LIMIT_MB = 5120  # 5 GB — generous, but blocks "infinite upload" footguns

DEFAULT_DIARIZATION_DEVICE = "auto"

# faster-whisper model size used for transcription. "base" matches the
# original hardcoded value, so an unset row keeps pre-feature behavior.
# The admin can switch to a larger model from the Transcription settings
# page (which downloads the weights first — see services/whisper_manager).
DEFAULT_WHISPER_MODEL = "base"

# Ollama model tag used to fill templates that don't pin their own llm_model.
# Mirrors ollama_client.DEFAULT_OLLAMA_MODEL; the onboarding wizard writes the
# user's picked model here so the templates it seeds (which leave llm_model
# null) format with the model the user actually downloaded.
DEFAULT_LLM_MODEL = "gemma3:4b"

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

# Audio storage. When True (default), /api/transcribe encrypts and keeps the
# original upload so the saved note has a playable recording. When False,
# transcription still runs but nothing is persisted — the note is text-only.
DEFAULT_AUDIO_STORAGE_ENABLED = True

# Days a saved audio file is kept before `flask purge-audio` deletes it,
# measured from its upload time. 0 = keep indefinitely (the purge job is a
# no-op). Same ~10-year ceiling as trash retention.
DEFAULT_AUDIO_RETENTION_DAYS = 0
MIN_AUDIO_RETENTION_DAYS = 0
MAX_AUDIO_RETENTION_DAYS = 3650

# When True (default), permanently deleting a note also deletes its encrypted
# audio recording once no other note still references that recording — closing
# the HIPAA §164.310(d) disposal gap where a "permanent" note delete left the
# patient's voice recording on disk. When False, the recording is left behind
# for the scheduled `flask purge-orphaned-audio` sweep to reclaim instead.
DEFAULT_ORPHANED_AUDIO_PURGE = True

# Idle session timeout. A logged-in user who makes no authenticated request
# for this many minutes is signed out automatically — the next request is
# rejected and the session row revoked. 0 disables the idle timeout. The
# ceiling is 24h, long enough for any "stay signed in for my shift" need.
DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 30
MIN_SESSION_IDLE_TIMEOUT_MINUTES = 0
MAX_SESSION_IDLE_TIMEOUT_MINUTES = 1440

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

# When True, a user can record additional audio onto a note that is still a
# fully editable draft (status 'draft' and not yet approved) and have the new
# transcript merged onto the existing one. Locks once the note is approved,
# finalized, or signed. Off by default — admins opt in. See
# services/transcript_append.py and POST /api/notes/<id>/append-recording.
DEFAULT_APPEND_RECORDING_ENABLED = False

# Admin-wide defaults for vocabulary and abbreviations. Both are empty by
# default — the feature only kicks in when an admin or user actually
# populates a list. Stored JSON-encoded under their respective keys.
DEFAULT_VOCABULARY_TERMS: list[str] = []
DEFAULT_ABBREVIATIONS: dict[str, str] = {}


# Set True once the first-run onboarding wizard has been completed. The
# frontend reads this to stop routing a returning admin back into /welcome.
DEFAULT_ONBOARDING_COMPLETED = False


# Password-strength policy applied to every credential-creation path (admin
# create-user, first-run setup, self-service change, admin reset, the
# create-admin CLI). "standard" enforces only a length floor (min 8) — fine for
# a single-user personal install. "strict" raises the floor to 12, rejects
# common/breached passwords, and requires 3 of 4 character classes — the
# multi-user / professional posture. See app/security/password_policy.py.
DEFAULT_PASSWORD_POLICY = "standard"
VALID_PASSWORD_POLICIES = ("standard", "strict")


# Audit-log retention. Audit rows are append-only and tamper-evident (an HMAC
# hash chain), so they are never silently dropped: `flask purge-audit-log`
# first writes the expired rows to a JSON archive file, then deletes them,
# leaving a watermark so the remaining chain still verifies. The window is
# measured from each row's created_at. The 7-year (2555-day) default sits
# comfortably above the HIPAA §164.316(b)(2) six-year documentation floor;
# 0 disables purging entirely — the full trail is kept forever. The ~10-year
# ceiling matches the trash/audio retention caps.
DEFAULT_AUDIT_RETENTION_DAYS = 2555
MIN_AUDIT_RETENTION_DAYS = 0
MAX_AUDIT_RETENTION_DAYS = 3650

# When True, `flask purge-audit-log` archives-and-deletes audit rows past the
# retention window. When False (default), the purge job is a no-op unless run
# with --force — so the audit trail is never trimmed without an explicit
# opt-in, mirroring trash_auto_purge.
DEFAULT_AUDIT_AUTO_PURGE = False


# Backup retention. `flask backup` writing into a directory prunes its own
# timestamped archives (privatescribe-backup-*.tar.gz) older than this many
# days, so a scheduled job doesn't fill the disk. Measured from each archive's
# modification time. 0 (default) keeps every backup forever — pruning only
# happens once an operator deliberately sets a window. The ~10-year ceiling
# matches the other retention caps. Only the app's own archives are ever
# touched; unrelated files in the directory are left alone.
DEFAULT_BACKUP_RETENTION_DAYS = 0
MIN_BACKUP_RETENTION_DAYS = 0
MAX_BACKUP_RETENTION_DAYS = 3650


# Account lockout (GAP-03 brute-force backstop). After this many consecutive
# failed password attempts, an account is locked for `account_lockout_minutes`
# — logins are refused before the password is even checked. The counter resets
# on any successful login. 0 disables lockout entirely (the per-IP rate limit
# is then the only brake). The ceiling is generous; 5 is a common default.
DEFAULT_ACCOUNT_LOCKOUT_THRESHOLD = 5
MIN_ACCOUNT_LOCKOUT_THRESHOLD = 0
MAX_ACCOUNT_LOCKOUT_THRESHOLD = 100

# How long a locked account stays locked, in minutes. After the window passes
# the account unlocks itself — no admin action needed — and gets a fresh set
# of attempts. The 24h ceiling matches the idle-timeout cap.
DEFAULT_ACCOUNT_LOCKOUT_MINUTES = 15
MIN_ACCOUNT_LOCKOUT_MINUTES = 1
MAX_ACCOUNT_LOCKOUT_MINUTES = 1440


# No-login (kiosk) mode. When True, the frontend silently auto-logs-in as the
# designated NO_LOGIN_USER_ID via /api/auth/auto-login — no password prompt —
# so a personal/home install can record a quick note without signing in each
# time. The auto-issued token carries a `kiosk` claim that require_admin
# rejects, so reaching admin settings still demands the admin password
# (step-up via /api/auth/elevate). Default False preserves the
# password-on-every-launch behavior. Intended for standalone/loopback installs;
# in a networked `server` deployment it is a credential-free token grant
# reachable by anyone who can hit the backend, so the UI warns loudly there.
DEFAULT_NO_LOGIN_MODE = False

# The id of the user that no-login mode auto-signs-in as. Set alongside
# NO_LOGIN_MODE (at setup time, or by the admin toggling it on). Empty when the
# mode has never been enabled.
DEFAULT_NO_LOGIN_USER_ID = ""


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


def get_llm_model() -> str:
    """App-wide default Ollama model — the fallback used to fill a template
    whose llm_model is null. The onboarding picker sets it via set_value()."""
    return get_str(LLM_MODEL, DEFAULT_LLM_MODEL)


def get_trash_retention_days() -> int:
    value = get_int(TRASH_RETENTION_DAYS, DEFAULT_TRASH_RETENTION_DAYS)
    # Clamp defensively — a bad row shouldn't make the floor negative or absurd.
    return max(MIN_TRASH_RETENTION_DAYS, min(MAX_TRASH_RETENTION_DAYS, value))


def get_trash_auto_purge() -> bool:
    return get_bool(TRASH_AUTO_PURGE, DEFAULT_TRASH_AUTO_PURGE)


def get_audio_storage_enabled() -> bool:
    return get_bool(AUDIO_STORAGE_ENABLED, DEFAULT_AUDIO_STORAGE_ENABLED)


def get_audio_retention_days() -> int:
    value = get_int(AUDIO_RETENTION_DAYS, DEFAULT_AUDIO_RETENTION_DAYS)
    # Clamp defensively — a bad row shouldn't make the window negative or absurd.
    return max(MIN_AUDIO_RETENTION_DAYS, min(MAX_AUDIO_RETENTION_DAYS, value))


def get_orphaned_audio_purge() -> bool:
    """Whether permanently deleting a note also deletes its now-unreferenced
    audio recording. When False, the recording is left for the scheduled
    `flask purge-orphaned-audio` sweep."""
    return get_bool(ORPHANED_AUDIO_PURGE, DEFAULT_ORPHANED_AUDIO_PURGE)


def get_session_idle_timeout_minutes() -> int:
    value = get_int(SESSION_IDLE_TIMEOUT_MINUTES, DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES)
    # Clamp defensively — a bad row shouldn't disable or absurdly extend it.
    return max(MIN_SESSION_IDLE_TIMEOUT_MINUTES, min(MAX_SESSION_IDLE_TIMEOUT_MINUTES, value))


def get_logout_on_close() -> bool:
    return get_bool(LOGOUT_ON_CLOSE, DEFAULT_LOGOUT_ON_CLOSE)


def get_two_factor_required() -> bool:
    return get_bool(TWO_FACTOR_REQUIRED, DEFAULT_TWO_FACTOR_REQUIRED)


def get_exports_enabled() -> bool:
    return get_bool(EXPORTS_ENABLED, DEFAULT_EXPORTS_ENABLED)


def get_dictation_markers_enabled() -> bool:
    return get_bool(DICTATION_MARKERS_ENABLED, DEFAULT_DICTATION_MARKERS_ENABLED)


def get_append_recording_enabled() -> bool:
    return get_bool(APPEND_RECORDING_ENABLED, DEFAULT_APPEND_RECORDING_ENABLED)


def get_onboarding_completed() -> bool:
    return get_bool(ONBOARDING_COMPLETED, DEFAULT_ONBOARDING_COMPLETED)


def get_password_policy() -> str:
    """Active password-strength policy. Falls back to the default if the row
    is missing or holds an unrecognized value."""
    value = get_str(PASSWORD_POLICY, DEFAULT_PASSWORD_POLICY)
    return value if value in VALID_PASSWORD_POLICIES else DEFAULT_PASSWORD_POLICY


def get_audit_retention_days() -> int:
    value = get_int(AUDIT_RETENTION_DAYS, DEFAULT_AUDIT_RETENTION_DAYS)
    # Clamp defensively — a bad row shouldn't make the window negative or absurd.
    return max(MIN_AUDIT_RETENTION_DAYS, min(MAX_AUDIT_RETENTION_DAYS, value))


def get_audit_auto_purge() -> bool:
    return get_bool(AUDIT_AUTO_PURGE, DEFAULT_AUDIT_AUTO_PURGE)


def get_backup_retention_days() -> int:
    """Days of backup archives to keep when `flask backup` prunes a directory.
    0 = keep forever (no pruning)."""
    value = get_int(BACKUP_RETENTION_DAYS, DEFAULT_BACKUP_RETENTION_DAYS)
    # Clamp defensively — a bad row shouldn't make the window negative or absurd.
    return max(MIN_BACKUP_RETENTION_DAYS, min(MAX_BACKUP_RETENTION_DAYS, value))


def get_last_backup_at() -> Optional[str]:
    """ISO timestamp of the last successful `flask backup`, or None if never.
    Surfaced in the server dashboard so an operator can see backup freshness."""
    return get_str(LAST_BACKUP_AT, "") or None


def get_account_lockout_threshold() -> int:
    """Consecutive failed password attempts before an account locks. 0 = the
    lockout feature is disabled."""
    value = get_int(ACCOUNT_LOCKOUT_THRESHOLD, DEFAULT_ACCOUNT_LOCKOUT_THRESHOLD)
    # Clamp defensively — a bad row shouldn't make the threshold negative or absurd.
    return max(MIN_ACCOUNT_LOCKOUT_THRESHOLD, min(MAX_ACCOUNT_LOCKOUT_THRESHOLD, value))


def get_account_lockout_minutes() -> int:
    """How long a locked account stays locked, in minutes."""
    value = get_int(ACCOUNT_LOCKOUT_MINUTES, DEFAULT_ACCOUNT_LOCKOUT_MINUTES)
    # Clamp defensively — a bad row shouldn't disable or absurdly extend it.
    return max(MIN_ACCOUNT_LOCKOUT_MINUTES, min(MAX_ACCOUNT_LOCKOUT_MINUTES, value))


def get_no_login_mode() -> bool:
    """Whether the app auto-logs-in as NO_LOGIN_USER_ID without a password."""
    return get_bool(NO_LOGIN_MODE, DEFAULT_NO_LOGIN_MODE)


def get_no_login_user_id() -> str:
    """Id of the user no-login mode signs in as, or "" if never enabled."""
    return get_str(NO_LOGIN_USER_ID, DEFAULT_NO_LOGIN_USER_ID)


def get_audit_archive_watermark() -> Optional[dict]:
    """The audit-log archival watermark, or None if nothing has been purged.

    A dict: {seq, entry_hash, archived_at, total_archived, last_archive_file}.
    `seq`/`entry_hash` are the highest archived row's chain position and hash —
    the remaining live chain links off `entry_hash`, and a new audit row picks
    up numbering at `seq` + 1 even when the table has been emptied. Written by
    app.services.audit_retention; read by the chain logic in app.services.audit.
    """
    raw = _get_raw(AUDIT_ARCHIVE_WATERMARK)
    if raw is None:
        return None
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


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
