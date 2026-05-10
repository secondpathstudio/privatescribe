import uuid
from datetime import datetime

from app.extensions import db


class AudioFile(db.Model):
    """An encrypted audio upload, linked to the transcript group it produced.

    Created by /api/transcribe before any Note exists, then linked by
    POST /api/notes via transcript_group_id once the user saves a note.
    Multiple notes formatted from the same recording (re-transcribes) share
    a transcript_group_id and therefore share this single audio row — we
    never duplicate the file when the user re-runs the LLM step.
    """
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False, index=True)
    # Set when the first note is created from this audio. Null = orphaned
    # upload (transcribe ran but the user never saved a note); a periodic
    # sweep can prune these.
    transcript_group_id = db.Column(db.String(36), nullable=True, index=True)
    original_filename = db.Column(db.String(512), nullable=False)
    # UUID we generate for the on-disk file; never trust client input here.
    stored_filename = db.Column(db.String(64), nullable=False, unique=True)
    mime_type = db.Column(db.String(100), nullable=True)
    size_bytes = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    finalized_at = db.Column(db.DateTime, nullable=True)

    def __repr__(self):
        return f"<AudioFile {self.id} group={self.transcript_group_id}>"
