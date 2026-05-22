"""Keyed SQLCipher connection factory.

The encryption key is mutable at runtime — admins can rotate it via
/api/admin/rotate-backup-key. We hold it in module-level state and expose
get/update helpers so routes can rekey without rebuilding the engine.
"""
import sqlcipher3

_state = {"db_path": None, "key": None}


def configure(db_path: str, key: str) -> None:
    """Called once from create_app() before db.init_app(app)."""
    _state["db_path"] = str(db_path)
    _state["key"] = key


def current_key() -> str:
    if _state["key"] is None:
        raise RuntimeError("SQLCipher key not configured")
    return _state["key"]


def update_key(new_key: str) -> None:
    """Swap the in-memory key after a successful PRAGMA rekey."""
    _state["key"] = new_key


def open_keyed_connection():
    """Engine `creator` callable. Opens a fresh connection with PRAGMA key as
    its very first statement so SQLCipher can decrypt the file."""
    # check_same_thread=False mirrors what SQLAlchemy's default sqlite dialect does
    # for URL-driven connections; without it, werkzeug's threaded dev server hands
    # pooled connections to other threads and sqlcipher3 raises ProgrammingError.
    # Safe because SQLAlchemy's pool serializes access to each connection.
    conn = sqlcipher3.connect(_state["db_path"], check_same_thread=False)
    conn.execute(f"PRAGMA key = \"x'{_state['key']}'\"")
    # The packaged backend serves on waitress with 8 threads, so multiple
    # connections write concurrently. Without a busy timeout SQLite raises
    # "database is locked" the instant two writers contend (seen in the wild
    # as dropped audit writes). 5s lets a writer wait for the lock instead of
    # failing immediately — the standard fix for multi-threaded SQLite.
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn
