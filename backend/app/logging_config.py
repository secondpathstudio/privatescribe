"""Operational file logging — PHI-safe, separate from the audit log.

The backend otherwise logs only to stderr, which the packaged Electron app
discards (its crash dialog captures only the rolling stderr tail on an actual
process crash, never a per-request 500). This attaches a rotating file handler
under the data dir so a field bug is diagnosable from a user-supplied log file
instead of guesswork — e.g. an upgrade-time ``no such column: ...`` line lands
in the file with its traceback.

PHI-safety is the whole contract. This is an *operational* log (request lines,
exception types/messages, lifecycle events) — NOT the compliance record (that's
the hash-chained ``AuditLog`` in the encrypted DB). It must never contain PHI,
which is enforced by:

  - ``hide_parameters=True`` on the engine (``app/database.py``), so SQL
    exceptions log the statement shape and DB error but never the bound
    parameters (note content, transcripts, participant names).
  - The ``sqlalchemy.engine`` logger pinned to WARNING, so even
    ``PRIVATESCRIBE_LOG_LEVEL=DEBUG`` can't echo SQL.
  - The request-logging hook recording ``request.path`` only (never the query
    string, which can carry a search term, nor the body).
  - A codebase discipline: don't log request bodies / ``raw_note`` /
    ``note_content_*`` / participant fields.

The file lives at ``<data_dir>/logs/privatescribe.log`` (dir 700, file 600 —
the same on-disk posture as ``.env``), and rotates to cap total size
(minimum-necessary / retention). Verbosity is gated by
``PRIVATESCRIBE_LOG_LEVEL`` (default ``INFO``); ``DEBUG`` is never shipped in a
packaged build.
"""
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

from flask import request

_VALID_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
_MAX_BYTES = 2 * 1024 * 1024  # 2 MB per file
_BACKUP_COUNT = 5             # ~12 MB total ceiling (active + 5 rotated)
_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
_DATEFMT = "%Y-%m-%dT%H:%M:%S%z"


class _SecureRotatingFileHandler(RotatingFileHandler):
    """RotatingFileHandler that re-applies 0600 every time it (re)opens the
    base file, so a post-rollover file can't inherit a looser umask."""

    def _open(self):
        stream = super()._open()
        try:
            os.chmod(self.baseFilename, 0o600)
        except OSError:
            pass
        return stream


def _resolve_level() -> int:
    raw = (os.getenv("PRIVATESCRIBE_LOG_LEVEL") or "INFO").strip().upper()
    if raw not in _VALID_LEVELS:
        raw = "INFO"
    return getattr(logging, raw)


def configure_logging(app) -> None:
    """Attach the rotating file handler + request-logging hook. Idempotent —
    safe to call once per ``create_app`` (tests, the dev reloader)."""
    level = _resolve_level()

    # Never let logging setup block boot: fall back to stderr-only on any error.
    logs_dir = Path(app.instance_path) / "logs"
    try:
        logs_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(logs_dir, 0o700)
    except OSError as e:
        app.logger.warning("File logging disabled: cannot prepare %s (%s)", logs_dir, e)
        _register_request_logging(app)
        return

    root = logging.getLogger()

    existing = next(
        (h for h in root.handlers if getattr(h, "_privatescribe", False)), None
    )
    if existing is not None:
        existing.setLevel(level)
    else:
        try:
            handler = _SecureRotatingFileHandler(
                logs_dir / "privatescribe.log",
                maxBytes=_MAX_BYTES,
                backupCount=_BACKUP_COUNT,
                encoding="utf-8",
            )
        except OSError as e:
            app.logger.warning("File logging disabled: cannot open log file (%s)", e)
            _register_request_logging(app)
            return
        handler._privatescribe = True  # tag for idempotent lookup above
        handler.setLevel(level)
        handler.setFormatter(logging.Formatter(_FORMAT, datefmt=_DATEFMT))
        root.addHandler(handler)

    # Ensure records actually reach the handler (a logger's effective level
    # gates record creation before any handler sees it).
    if root.level == logging.NOTSET or root.level > level:
        root.setLevel(level)

    # Belt-and-suspenders: SQL must never be echoed, even at DEBUG, since the
    # statement+parameters path is the one place PHI could reach a log.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    _register_request_logging(app)
    app.logger.info(
        "File logging enabled at %s (level=%s)",
        logs_dir / "privatescribe.log", logging.getLevelName(level),
    )


def _register_request_logging(app) -> None:
    """Log failing requests (4xx WARNING, 5xx ERROR) with method + path only.

    PHI-safe: ``request.path`` excludes the query string (which can carry a
    search term) and the body. Successful requests are left unlogged to keep
    the file high-signal. Idempotent via an app-level flag."""
    if app.config.get("_REQUEST_LOGGING_REGISTERED"):
        return
    app.config["_REQUEST_LOGGING_REGISTERED"] = True

    @app.after_request
    def _log_failed_response(response):
        try:
            status = response.status_code
            if status >= 500:
                app.logger.error("%s %s -> %s", request.method, request.path, status)
            elif status >= 400:
                app.logger.warning("%s %s -> %s", request.method, request.path, status)
        except Exception:  # noqa: BLE001 - logging must never break a response
            pass
        return response
