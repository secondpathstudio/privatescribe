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
import os
import threading
from datetime import timedelta
from pathlib import Path

from flask import Flask
from flask_cors import CORS

from app.cli import register_cli
from app.errors import register_error_handlers
from app.extensions import db, jwt, limiter, migrate
from app.json_provider import ISODateJSONProvider
from app.paths import data_dir
from app.routes import register_blueprints
from app.security import sqlcipher
from app.security.secrets import ensure_jwt_secret, ensure_sqlcipher_key


def create_app() -> Flask:
    # instance_path holds the encrypted DB and audio files. data_dir() honors
    # PRIVATESCRIBE_DATA_DIR so embedded runs can point this at user-writable
    # storage outside the read-only app bundle.
    app = Flask(__name__, instance_path=str(data_dir()))
    app.json = ISODateJSONProvider(app)

    CORS(app, supports_credentials=True, origins=["http://localhost:3000"])

    # Secrets — generated and persisted to backend/.env on first boot.
    app.config["JWT_SECRET_KEY"] = ensure_jwt_secret()
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=1)
    sqlcipher_key = ensure_sqlcipher_key()

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

    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'creator': sqlcipher.open_keyed_connection}
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

    register_blueprints(app)
    register_error_handlers(app)
    register_cli(app)

    with app.app_context():
        db.create_all()
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
    # /api/transcribe doesn't pay cold-load cost. Gated on HF_TOKEN being set —
    # otherwise get_pipeline() raises DiarizationUnavailable on every boot,
    # which we'd just have to swallow and log noisily.
    if os.getenv("HF_TOKEN"):
        def _prewarm():
            try:
                from app.services.diarization import get_pipeline
                get_pipeline()
            except Exception as e:
                print(f"Diarization pre-warm failed (will retry on first request): {type(e).__name__}: {e}")
        threading.Thread(target=_prewarm, daemon=True, name="diarization-prewarm").start()

    return app
