"""Resolve filesystem locations for the encrypted DB, .env, and audio files.

Default (developer running `flask run`):
- backend/instance/   — DB + audio
- backend/.env        — JWT and SQLCipher keys

Embedded mode (Electron, packaged binary): the parent process sets
PRIVATESCRIBE_DATA_DIR to a writable user-owned directory outside the
read-only app bundle. Both DB and .env move into that single directory
so the user has one folder to back up.
"""
import os
from pathlib import Path
from typing import Optional

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _override_dir() -> Optional[Path]:
    raw = os.getenv("PRIVATESCRIBE_DATA_DIR")
    return Path(raw).expanduser().resolve() if raw else None


def data_dir() -> Path:
    """Directory holding the SQLCipher DB and encrypted audio files."""
    d = _override_dir() or _BACKEND_ROOT / "instance"
    d.mkdir(parents=True, exist_ok=True)
    return d


def env_path() -> Path:
    """Location of the .env file with JWT_SECRET_KEY and SQLCIPHER_KEY."""
    override = _override_dir()
    if override:
        return override / ".env"
    return _BACKEND_ROOT / ".env"
