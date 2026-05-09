import uuid
from datetime import datetime

from app.extensions import db


class KeyExportLog(db.Model):
    __tablename__ = 'key_export_log'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    admin_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=True)
    admin_email = db.Column(db.String(100), nullable=False)
    exported_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    ip = db.Column(db.String(64), nullable=True)


class KeyExportDismissal(db.Model):
    __tablename__ = 'key_export_dismissal'
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), primary_key=True)
    dismissed_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
