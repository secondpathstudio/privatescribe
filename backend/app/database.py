"""Build the SQLAlchemy engine configuration for the active deployment.

This is seam #1 of the Postgres-ready work (roadmap Phase 7): **all**
database-engine selection lives in one place, so adding the later Postgres
tier is filling in a branch rather than restructuring ``create_app()``.
Nothing engine-specific leaks past the ``(uri, options)`` this returns —
routes, models, and services stay dialect-agnostic.

The selector is the presence of ``PRIVATESCRIBE_DATABASE_URL``, not the
deployment *mode*: a server can run either the default encrypted-SQLite tier
or (later) the Postgres tier, so the engine axis is orthogonal to
standalone-vs-server. Today there is exactly one live engine — encrypted
SQLite via SQLCipher, shared by standalone and the SQLite-tier server.
"""
import os
from pathlib import Path

from app.security import sqlcipher


def engine_config(db_path: Path) -> tuple[str, dict]:
    """Return ``(SQLALCHEMY_DATABASE_URI, SQLALCHEMY_ENGINE_OPTIONS)``.

    Defaults to encrypted SQLite. ``PRIVATESCRIBE_DATABASE_URL`` opts into the
    Postgres tier, which isn't built yet (see ``_external_engine_config``).
    """
    database_url = (os.getenv("PRIVATESCRIBE_DATABASE_URL") or "").strip()
    if database_url:
        return _external_engine_config(database_url)
    return _sqlcipher_engine_config(db_path)


def _sqlcipher_engine_config(db_path: Path) -> tuple[str, dict]:
    """Encrypted SQLite via SQLCipher — the live path.

    The ``creator`` callable opens every pooled connection with ``PRAGMA key``
    as its first statement (then WAL + busy_timeout), so the URI is nominal:
    ``creator`` bypasses URL-based connecting entirely.
    """
    return (
        f"sqlite:///{db_path}",
        {
            "creator": sqlcipher.open_keyed_connection,
            # Keep bound parameters out of DBAPI exception messages (and any
            # statement logging). The operational file log (app/logging_config.py)
            # must stay PHI-free, and SQL parameters are note content, transcripts,
            # and participant names. echo stays off for the same reason.
            "hide_parameters": True,
        },
    )


def _external_engine_config(database_url: str) -> tuple[str, dict]:
    """Postgres tier (roadmap Phase 7b) — the stub the seam exists for.

    When this lands it returns the psycopg URL plus engine options
    (``sslmode=verify-full``, ``pool_size``/``max_overflow`` for the worker
    pool); the rest of ``create_app()`` is untouched. Until then, fail loudly
    so a stray ``PRIVATESCRIBE_DATABASE_URL`` can't half-wire the app onto a
    backend that has no migrations or search implementation yet.
    """
    raise NotImplementedError(
        "PRIVATESCRIBE_DATABASE_URL is set, but the Postgres tier isn't built "
        "yet (roadmap Phase 7b). Unset it to use the default encrypted SQLite."
    )
