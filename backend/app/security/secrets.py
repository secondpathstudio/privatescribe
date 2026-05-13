"""Secrets bootstrapping: JWT secret and SQLCipher key.

Both are auto-generated on first boot and persisted to .env.
The .env file is chmod 600 so the keys aren't world-readable.

The .env location is resolved lazily via app.paths.env_path() so that
embedded runs (Electron, packaged binary) honor PRIVATESCRIBE_DATA_DIR
without import-time path freezing.
"""
import os
import secrets

from dotenv import load_dotenv, set_key

from app.paths import env_path


def _chmod_env_quietly():
    try:
        env_path().chmod(0o600)
    except OSError:
        pass


def ensure_jwt_secret() -> str:
    path = env_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=True)
    load_dotenv(path)
    secret = os.getenv("JWT_SECRET_KEY")
    if not secret:
        secret = secrets.token_urlsafe(64)
        set_key(str(path), "JWT_SECRET_KEY", secret)
        os.environ["JWT_SECRET_KEY"] = secret
        print(f"[init] Generated new JWT_SECRET_KEY and wrote to {path}")
    _chmod_env_quietly()
    return secret


def ensure_sqlcipher_key() -> str:
    path = env_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=True)
    load_dotenv(path)
    key = os.getenv("SQLCIPHER_KEY")
    if not key:
        key = secrets.token_hex(32)
        set_key(str(path), "SQLCIPHER_KEY", key)
        os.environ["SQLCIPHER_KEY"] = key
        bar = "=" * 78
        print(f"\n{bar}")
        print("  SQLCIPHER_KEY GENERATED — back this up NOW")
        print(bar)
        print(f"  Key (hex): {key}")
        print(f"  Stored in: {path}")
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
    set_key(str(env_path()), "SQLCIPHER_KEY_ACKNOWLEDGED", "true")
    os.environ["SQLCIPHER_KEY_ACKNOWLEDGED"] = "true"


def reset_backup_key_acknowledgement() -> None:
    """Clear the ack flag so other admins get the one-shot save modal again."""
    set_key(str(env_path()), "SQLCIPHER_KEY_ACKNOWLEDGED", "false")
    os.environ["SQLCIPHER_KEY_ACKNOWLEDGED"] = "false"


def persist_sqlcipher_key(new_key: str) -> None:
    """Write a rotated SQLCipher key to .env and update the live env."""
    set_key(str(env_path()), "SQLCIPHER_KEY", new_key)
    os.environ["SQLCIPHER_KEY"] = new_key
    _chmod_env_quietly()
