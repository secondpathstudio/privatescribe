import uuid
from datetime import datetime

from app.extensions import db


# Many-to-many: notes <-> participants.
note_participants = db.Table(
    'note_participants',
    db.Column('note_id', db.String(36), db.ForeignKey('note.id', ondelete='CASCADE'), primary_key=True),
    db.Column('participant_id', db.String, db.ForeignKey('participant.id', ondelete='CASCADE'), primary_key=True),
)

# Many-to-many: users <-> participants (currently unused in routes but kept
# so create_all() preserves the existing schema).
user_participants = db.Table(
    'user_participants',
    db.Column('user_id', db.String(36), db.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
    db.Column('participant_id', db.String(36), db.ForeignKey('participant.id', ondelete='CASCADE'), primary_key=True),
)


class Participant(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=True)
    email = db.Column(db.String(100), unique=False, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    notes = db.relationship('Note', secondary='note_participants', back_populates='participants')

    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    # Tenant boundary (Phase 8): denormalized from the author's organization so
    # cross-org filtering is a direct indexed column, not a join through user.
    # Nullable for standalone/legacy rows; stamped on insert (services/org_stamp.py).
    organization_id = db.Column(db.String(36), db.ForeignKey('organization.id'), nullable=True, index=True)

    def __repr__(self):
        return f"<Participant {self.first_name} {self.last_name}>"
