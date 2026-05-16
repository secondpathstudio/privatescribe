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
    # False when an admin has deactivated the account (off-boarding). A
    # deactivated user can't log in and all their sessions are revoked, but
    # their notes/templates/participants are kept. Reversible from the admin
    # Users page.
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    # TOTP-based 2FA. `totp_secret` is the base32-encoded shared secret stored
    # in the encrypted DB (never returned over the wire). `totp_enrolled_at`
    # is the source of truth for "is this user enrolled" — `totp_secret` may
    # be non-null while enrollment is still pending verification of the first
    # code, in which case `totp_enrolled_at` stays null and the secret is
    # overwritten on the next /enroll call.
    totp_secret = db.Column(db.String(64), nullable=True)
    totp_enrolled_at = db.Column(db.DateTime, nullable=True)
    # JSON-encoded list of werkzeug password hashes of one-time recovery codes.
    # On use, the matching slot is replaced with null so the list length stays
    # stable and the user can see how many they have left.
    recovery_codes = db.Column(db.Text, nullable=True)
    # JSON-encoded user-scoped overlays for transcription. Both default to
    # empty containers so the merge logic in services/vocabulary.py can
    # treat "no row yet" and "empty list" the same way.
    #   vocabulary_terms: JSON array of strings — passed to Whisper as part
    #     of `initial_prompt` to bias recognition toward domain terms.
    #   abbreviations:    JSON object {short: long} — applied as case-
    #     insensitive whole-word substitution after Whisper, before the LLM.
    # Admin-wide defaults live in the system_setting table; merge logic
    # combines them (user values win on key conflicts for abbreviations).
    vocabulary_terms = db.Column(db.Text, nullable=False, default='[]')
    abbreviations = db.Column(db.Text, nullable=False, default='{}')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, default=datetime.utcnow)

    notes = db.relationship('Note', backref='user', lazy=True, cascade='all, delete-orphan')
    templates = db.relationship('Template', backref='user', lazy=True, cascade='all, delete-orphan')
    participants = db.relationship('Participant', backref='user', lazy=True, cascade='all, delete-orphan')

    def __repr__(self):
        return f"<User {self.email}>"
