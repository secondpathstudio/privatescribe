"""App-wide admin-configurable settings stored in the system_setting table.

Values are JSON-encoded so a single Text column can hold ints, strings, bools,
or small structures. Callers should use the typed accessors (get_int, etc.)
which apply defaults if the row is missing or malformed.
"""
import json
from datetime import datetime
from typing import Optional

from app.extensions import db
from app.models import SystemSetting

# Known setting keys. Centralized so frontend and routes stay in sync.
UPLOAD_LIMIT_MB = "upload_limit_mb"

DEFAULT_UPLOAD_LIMIT_MB = 500
MIN_UPLOAD_LIMIT_MB = 1
MAX_UPLOAD_LIMIT_MB = 5120  # 5 GB — generous, but blocks "infinite upload" footguns


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
