"""PrivateScribe Flask application factory.

Creates a fully wired Flask app:
- Loads JWT and SQLCipher secrets from .env (auto-generates on first boot).
- Configures SQLAlchemy with a SQLCipher-keyed connection creator so every
  pooled connection opens with PRAGMA key as its first statement.
- Initializes JWT, CORS, rate limiter, and Flask-Migrate.
- Imports all models so db.create_all() / Alembic see them on metadata.
- Registers blueprints, error handlers, and CLI commands.
"""
from datetime import timedelta
from pathlib import Path

from flask import Flask
from flask_cors import CORS

from app.cli import register_cli
from app.errors import register_error_handlers
from app.extensions import db, jwt, limiter, migrate
from app.json_provider import ISODateJSONProvider
from app.routes import register_blueprints
from app.security import sqlcipher
from app.security.secrets import ensure_jwt_secret, ensure_sqlcipher_key


def create_app() -> Flask:
    app = Flask(__name__)
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

    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'creator': sqlcipher.open_keyed_connection}
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

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

    return app
