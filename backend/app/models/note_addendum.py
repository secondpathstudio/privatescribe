import uuid
from datetime import datetime

from app.extensions import db


class NoteAddendum(db.Model):
    """An append-only entry added to a note after it has been signed.

    Signed notes are immutable — their body never changes again. An
    addendum is the sanctioned way to record follow-up information: a
    separate dated, authored text block displayed below the signed note.
    Addenda are themselves immutable once created (no edit/update route);
    a correction is just another addendum.
    """
    __tablename__ = 'note_addendum'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    note_id = db.Column(db.String(36), db.ForeignKey('note.id'), nullable=False, index=True)
    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    # Tenant boundary (Phase 8): denormalized from the author's organization so
    # cross-org filtering is a direct indexed column, not a join through user.
    # Nullable for standalone/legacy rows; stamped on insert (services/org_stamp.py).
    organization_id = db.Column(db.String(36), db.ForeignKey('organization.id'), nullable=True, index=True)
    # Denormalized author display name, mirroring Note.author_name — so an
    # addendum still renders a name even if the user row changes later.
    author_name = db.Column(db.String(100), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def __repr__(self):
        return f"<NoteAddendum {self.id} note={self.note_id}>"
