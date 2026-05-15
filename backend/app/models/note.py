import uuid
from datetime import datetime

from app.extensions import db


class Note(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    author_name = db.Column(db.String(100), nullable=False)
    note_date = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    note_content_raw = db.Column(db.Text, nullable=False)
    note_content_markdown = db.Column(db.Text, nullable=False)
    # Diarized turns: [{speaker, start, end, text}, ...] — None when diarization
    # was off or unavailable. Stored as JSON (SQLite TEXT under the hood).
    note_content_segments = db.Column(db.JSON, nullable=True)
    # Per-word Whisper output: [{word, probability, start, end}, ...] — None
    # for legacy rows or when not captured. Powers the low-confidence
    # highlighting on the raw transcript view. Stays useful even after the
    # user edits the raw text since the frontend uses a forward-greedy match
    # that tolerates substitutions and reordering.
    note_content_words = db.Column(db.JSON, nullable=True)
    # Approval timestamp. Null while the note is in draft (raw transcript
    # editable, highlights visible). Set when the user clicks Approve, at
    # which point the raw transcript becomes immutable forever — the regular
    # update endpoint rejects raw-text changes once this is set. One-way for
    # v1; no un-approve path.
    approved_at = db.Column(db.DateTime, nullable=True)
    note_type = db.Column(db.String(50), nullable=False)
    version = db.Column(db.Integer(), nullable=False, default=1)
    is_deleted = db.Column(db.Boolean, default=False)
    is_deleted_timestamp = db.Column(db.DateTime, nullable=True)

    # All notes formatted from the same raw transcript share this id.
    # Singletons get their own UUID; re-transcribes inherit from the source.
    transcript_group_id = db.Column(db.String(36), nullable=True, index=True)

    template_id = db.Column(db.String(36), db.ForeignKey('template.id'), nullable=True)
    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)

    participants = db.relationship('Participant', secondary='note_participants', back_populates='notes')

    def __repr__(self):
        return f"<Note {self.id}>"
