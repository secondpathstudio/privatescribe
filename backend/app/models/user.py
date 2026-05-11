import uuid
from datetime import datetime

from app.extensions import db


class User(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = db.Column(db.String(100), unique=True, nullable=False)
    role = db.Column(db.String(50), default='user')
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)
    password = db.Column(db.String(255), nullable=False)
    # True when an admin has reset this user's password. The frontend routes
    # the user to the change-password screen on next login and the user can't
    # navigate elsewhere until they pick their own password. Cleared by the
    # self-service /api/me/change-password endpoint.
    force_password_change = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, default=datetime.utcnow)

    notes = db.relationship('Note', backref='user', lazy=True, cascade='all, delete-orphan')
    templates = db.relationship('Template', backref='user', lazy=True, cascade='all, delete-orphan')
    participants = db.relationship('Participant', backref='user', lazy=True, cascade='all, delete-orphan')

    def __repr__(self):
        return f"<User {self.email}>"
