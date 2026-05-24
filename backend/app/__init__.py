"""PrivateScribe Flask application factory.

Creates a fully wired Flask app:
- Loads JWT and SQLCipher secrets from .env (auto-generates on first boot).
- Configures SQLAlchemy with a SQLCipher-keyed connection creator so every
  pooled connection opens with PRAGMA key as its first statement.
- Initializes JWT, CORS, rate limiter, and Flask-Migrate.
- Imports all models so db.create_all() / Alembic see them on metadata.
- Registers blueprints, error handlers, and CLI commands.
- Pre-warms the pyannote diarization pipeline in a background thread so the
  first /api/transcribe call doesn't pay the ~5–10s cold-load cost.
"""
import logging
import os
import threading
from datetime import timedelta
from pathlib import Path

from flask import Flask
from flask_cors import CORS

from app.cli import register_cli
from app.database import engine_config
from app.deployment import cors_origins, resolve_mode
from app.errors import register_error_handlers
from app.extensions import db, jwt, limiter, migrate
from app.json_provider import ISODateJSONProvider
from app.paths import data_dir
from app.routes import register_blueprints
from app.security import sqlcipher
from app.security.auth import request_guard
from app.security.secrets import (
    ensure_audit_hmac_key,
    ensure_jwt_secret,
    ensure_sqlcipher_key,
)

logger = logging.getLogger(__name__)


def create_app() -> Flask:
    # instance_path holds the encrypted DB and audio files. data_dir() honors
    # PRIVATESCRIBE_DATA_DIR so embedded runs can point this at user-writable
    # storage outside the read-only app bundle.
    app = Flask(__name__, instance_path=str(data_dir()))
    app.json = ISODateJSONProvider(app)

    # Deployment role (standalone | server), resolved from PRIVATESCRIBE_MODE.
    # Stored once here so every later config decision (bind host, CORS, debug)
    # reads one resolved value rather than re-parsing the env. Defaults to the
    # loopback-only standalone posture; nothing keys off it yet.
    app.config["DEPLOYMENT_MODE"] = resolve_mode()
    logger.info("Deployment mode: %s", app.config["DEPLOYMENT_MODE"])

    # Allowed CORS origins come from the mode + PRIVATESCRIBE_CORS_ORIGINS.
    # Standalone keeps trusting the local frontend (http://localhost:3000); a
    # server denies cross-origin until its clients are whitelisted via the env.
    CORS(
        app,
        supports_credentials=True,
        origins=cors_origins(app.config["DEPLOYMENT_MODE"]),
    )

    # Secrets — generated and persisted to backend/.env on first boot.
    app.config["JWT_SECRET_KEY"] = ensure_jwt_secret()
    # Access tokens are long-lived because the server-side Session row — not
    # the token's own expiry — governs how long a login lasts. The request
    # guard validates the session (idle timeout, logout, deactivation) on
    # every call, so a revoked session kills the token immediately regardless
    # of this TTL. The generous TTL just keeps an actively-working user from
    # being interrupted by a token expiring out from under them.
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=7)
    sqlcipher_key = ensure_sqlcipher_key()

    # Install the audit-log HMAC key (separate from the DB key) so log_action
    # can sign the tamper-evidence hash chain. See app/services/audit.py.
    from app.services import audit as audit_service
    audit_service.configure(ensure_audit_hmac_key())

    # Encrypted SQLite via SQLCipher. The `creator` callable bypasses URL-based
    # connecting so every pooled connection is opened with PRAGMA key set as
    # its first statement.
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    db_path = Path(app.instance_path) / "privatescribe.db"
    sqlcipher.configure(db_path=db_path, key=sqlcipher_key)

    # Encrypted audio uploads live alongside the DB; they're encrypted with
    # a key derived from SQLCIPHER_KEY (see app/services/audio_storage.py).
    from app.services import audio_storage
    audio_storage.configure(Path(app.instance_path) / "audio")
    # Finish any in-flight key rotation that crashed between PRAGMA rekey
    # and the audio file rename sweep. Idempotent and cheap when there's
    # nothing pending.
    audio_storage.recover_pending_reencryption()

    # Resolve the ffmpeg binary pydub shells out to and pin AudioSegment at
    # it. The packaged desktop app has no system ffmpeg on PATH, so without
    # this an upload fails with "No such file or directory: 'ffmpeg'".
    from app.services import ffmpeg as ffmpeg_service
    ffmpeg_service.configure()

    # Live-transcription sessions keep a temp webm in the OS temp dir; the
    # registry tracking them doesn't survive a restart, so sweep any
    # leftovers from a previous run.
    from app.routes.transcription_live import cleanup_stale_session_files
    cleanup_stale_session_files()

    # Engine selection lives in one place (app/database.py) so the later
    # Postgres tier is an additive branch, not a create_app() rewrite. Today
    # this returns the encrypted-SQLite + SQLCipher-creator config unchanged.
    uri, engine_options = engine_config(db_path)
    app.config['SQLALCHEMY_DATABASE_URI'] = uri
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = engine_options
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    # Provisional upload cap; the real value is loaded from the system_setting
    # table after db.create_all() below. Pre-DB requests (none in practice)
    # would otherwise be uncapped.
    from app.services.settings import DEFAULT_UPLOAD_LIMIT_MB
    app.config['MAX_CONTENT_LENGTH'] = DEFAULT_UPLOAD_LIMIT_MB * 1024 * 1024

    # Bind extensions to this app.
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    limiter.init_app(app)

    # Importing the models package triggers registration on db.metadata so
    # create_all() and Flask-Migrate's autogenerate see every table.
    # Use `from . import` so the statement binds `models`, not `app` — an
    # `import app.models` here would shadow the local `app` Flask instance.
    from . import models  # noqa: F401

    # Importing note_search registers its mapper-level event listeners on
    # the Note model. Must happen before any flush so create/update/delete
    # of notes maintains the FTS5 index in lockstep.
    from .services import note_search  # noqa: F401

    # Importing org_stamp registers before_insert listeners that denormalize
    # organization_id onto new PHI rows (Phase 8 tenant boundary). Like
    # note_search, it must load before any flush so every insert is stamped.
    from .services import org_stamp  # noqa: F401

    register_blueprints(app)
    register_error_handlers(app)
    register_cli(app)

    # App-wide request guard: validates the server-side session (logout, idle
    # timeout), blocks deactivated accounts, and confines force_password_change
    # users. Registered here, not per-route, so a new blueprint can't skip it.
    app.before_request(request_guard)

    with app.app_context():
        db.create_all()
        # Pick the search backend for the bound engine (SQLite → FTS5) before
        # touching the index, so the seam is explicit rather than defaulted.
        note_search.select_backend()
        # The FTS5 virtual table can't be expressed via SQLAlchemy metadata,
        # so db.create_all() doesn't create it. Migrations do, but fresh
        # boots that skip Alembic still need it — DDL is idempotent.
        note_search.ensure_fts_table()
        # Likewise the append-only triggers on the audit tables: SQLAlchemy
        # metadata can't express them, so install them here for fresh boots.
        # The migration creates the same triggers — both paths are idempotent.
        audit_service.ensure_audit_triggers()
        # Load the admin-configured upload cap from the DB so MAX_CONTENT_LENGTH
        # reflects whatever was set in the previous session. Per-request PUTs
        # to /api/admin/settings/upload-limit-mb update this live.
        from app.services.settings import get_diarization_device, get_upload_limit_mb
        app.config['MAX_CONTENT_LENGTH'] = get_upload_limit_mb() * 1024 * 1024

        # Seed the diarization service with the admin-configured device so the
        # first load (whether from pre-warm below or from a real request) uses
        # it. Defaults to "auto" if never set.
        from app.services import diarization
        try:
            diarization.set_configured_device(get_diarization_device())
        except ValueError:
            # Persisted value is no longer in VALID_DEVICES (e.g. we removed
            # an option). Fall back to auto rather than crashing the app.
            diarization.set_configured_device("auto")

    # Pre-warm the pyannote pipeline in a background thread so the first
    # /api/transcribe doesn't pay cold-load cost. Gated on diarization being
    # configured at all (bundled weights staged, or HF_TOKEN set) — otherwise
    # get_pipeline() raises DiarizationUnavailable on every boot, which we'd
    # just have to swallow and log noisily.
    if diarization.is_available():
        def _prewarm():
            try:
                from app.services.diarization import get_pipeline
                get_pipeline()
            except Exception as e:
                logger.warning(f"Diarization pre-warm failed (will retry on first request): {type(e).__name__}: {e}")
        threading.Thread(target=_prewarm, daemon=True, name="diarization-prewarm").start()

    return app
