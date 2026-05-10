from datetime import datetime

from app.extensions import db


class SystemSetting(db.Model):
    """Generic key/value table for admin-configurable, app-wide settings.

    Values are stored as JSON-encoded text so the same table can hold ints,
    strings, bools, or small structures without a schema migration per setting.
    """
    __tablename__ = 'system_setting'

    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=True)

    def __repr__(self):
        return f"<SystemSetting {self.key}={self.value!r}>"
