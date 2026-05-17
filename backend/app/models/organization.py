import uuid
from datetime import datetime

from app.extensions import db


class Organization(db.Model):
    """The practice or clinic this installation belongs to.

    One row per install today: the admin sets it during first-run setup and
    every user inherits it (User.organization_id). Modelled as its own table
    rather than an app-wide setting so it can become a real tenant boundary
    if PrivateScribe later runs as a centralized multi-client server.
    """
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    users = db.relationship('User', backref='organization', lazy=True)

    def __repr__(self):
        return f"<Organization {self.name}>"
