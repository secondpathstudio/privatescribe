"""Secrets bootstrapping: JWT secret and SQLCipher key.

Both are auto-generated on first boot and persisted to backend/.env.
The .env file is chmod 600 so the keys aren't world-readable.
"""
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv, set_key

ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"


def _chmod_env_quietly():
    try:
        ENV_PATH.chmod(0o600)
    except OSError:
        pass


def ensure_jwt_secret() -> str:
    ENV_PATH.touch(exist_ok=True)
    load_dotenv(ENV_PATH)
    secret = os.getenv("JWT_SECRET_KEY")
    if not secret:
        secret = secrets.token_urlsafe(64)
        set_key(str(ENV_PATH), "JWT_SECRET_KEY", secret)
        os.environ["JWT_SECRET_KEY"] = secret
        print(f"[init] Generated new JWT_SECRET_KEY and wrote to {ENV_PATH}")
    _chmod_env_quietly()
    return secret


def ensure_sqlcipher_key() -> str:
    ENV_PATH.touch(exist_ok=True)
    load_dotenv(ENV_PATH)
    key = os.getenv("SQLCIPHER_KEY")
    if not key:
        key = secrets.token_hex(32)
        set_key(str(ENV_PATH), "SQLCIPHER_KEY", key)
        os.environ["SQLCIPHER_KEY"] = key
        bar = "=" * 78
        print(f"\n{bar}")
        print("  SQLCIPHER_KEY GENERATED — back this up NOW")
        print(bar)
        print(f"  Key (hex): {key}")
        print(f"  Stored in: {ENV_PATH}")
        print()
        print("  This key is the only thing that can decrypt your database.")
        print("  Save it somewhere durable (password manager, encrypted backup).")
        print("  Lose both the key and this .env file and your data is unrecoverable.")
        print(f"{bar}\n")
    _chmod_env_quietly()
    return key


def is_backup_key_acknowledged() -> bool:
    return os.getenv("SQLCIPHER_KEY_ACKNOWLEDGED", "").lower() == "true"


def mark_backup_key_acknowledged() -> None:
    set_key(str(ENV_PATH), "SQLCIPHER_KEY_ACKNOWLEDGED", "true")
    os.environ["SQLCIPHER_KEY_ACKNOWLEDGED"] = "true"


def reset_backup_key_acknowledgement() -> None:
    """Clear the ack flag so other admins get the one-shot save modal again."""
    set_key(str(ENV_PATH), "SQLCIPHER_KEY_ACKNOWLEDGED", "false")
    os.environ["SQLCIPHER_KEY_ACKNOWLEDGED"] = "false"


def persist_sqlcipher_key(new_key: str) -> None:
    """Write a rotated SQLCipher key to .env and update the live env."""
    set_key(str(ENV_PATH), "SQLCIPHER_KEY", new_key)
    os.environ["SQLCIPHER_KEY"] = new_key
    _chmod_env_quietly()
