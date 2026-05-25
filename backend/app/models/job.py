import uuid
from datetime import datetime

from app.extensions import db


class Job(db.Model):
    """A queued background task — currently audio transcription (Phase 13).

    Enqueued from an uploaded AudioFile; an in-process worker thread in the
    backend daemon runs the Whisper (+ optional diarization / LLM-format)
    pipeline and writes a *draft* Note, then marks the job done. This is what
    lets a batch of recordings (e.g. a day off a portable recorder) be ingested
    without holding one streaming HTTP request per file.

    Org-stamped like the other PHI models (services/org_stamp.py) so it respects
    the tenant boundary; the worker runs without a request context, so the
    org-guard doesn't filter it (it processes every org's queue).
    """
    # queued -> running -> (done | failed | canceled)
    STATUS_QUEUED = "queued"
    STATUS_RUNNING = "running"
    STATUS_DONE = "done"
    STATUS_FAILED = "failed"
    STATUS_CANCELED = "canceled"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False, index=True)
    # Tenant boundary (Phase 8): denormalized from the author's org, stamped on
    # insert. Nullable for standalone/legacy.
    organization_id = db.Column(db.String(36), db.ForeignKey('organization.id'), nullable=True, index=True)

    # Job kind — only 'transcription' today; the column lets us add others.
    type = db.Column(db.String(32), nullable=False, default='transcription')
    status = db.Column(db.String(16), nullable=False, default=STATUS_QUEUED, index=True)

    # What to process and (optionally) how to format it.
    audio_file_id = db.Column(db.String(36), db.ForeignKey('audio_file.id'), nullable=True, index=True)
    template_id = db.Column(db.String(36), db.ForeignKey('template.id'), nullable=True)
    # The draft note produced — set when the job completes.
    note_id = db.Column(db.String(36), db.ForeignKey('note.id'), nullable=True)

    # Coarse 0-100 progress plus a human-readable stage for the queue UI.
    progress = db.Column(db.Integer, nullable=False, default=0)
    stage = db.Column(db.String(64), nullable=True)
    error_text = db.Column(db.Text, nullable=True)
    attempts = db.Column(db.Integer, nullable=False, default=0)

    # Display label (original filename) for the queue list.
    label = db.Column(db.String(512), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
    started_at = db.Column(db.DateTime, nullable=True)
    finished_at = db.Column(db.DateTime, nullable=True)

    def __repr__(self):
        return f"<Job {self.id} {self.type} {self.status}>"
