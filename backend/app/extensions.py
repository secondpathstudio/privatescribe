"""Unbound Flask extension instances.

Imported by both the application factory (which calls .init_app on each) and
by models/routes (which only need the object, not the app). Keeping these in
their own module is what prevents circular imports between models and the
factory.
"""
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager
from flask_migrate import Migrate
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

db = SQLAlchemy()
jwt = JWTManager()
migrate = Migrate()
limiter = Limiter(key_func=get_remote_address, storage_uri="memory://")
