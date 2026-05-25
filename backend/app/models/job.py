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

    # What to process and how to format it. The transcript is produced ONCE;
    # the LLM-format step then runs per template, so a single recording can
    # fan out into several notes (e.g. encounter note + ICD-10 extract +
    # interaction feedback). Stored as a JSON list of template ids (empty/None
    # => one note with the raw transcript). FK can't be expressed on a JSON
    # list, so the route validates the ids on enqueue.
    audio_file_id = db.Column(db.String(36), db.ForeignKey('audio_file.id'), nullable=True, index=True)
    # Label speakers (pyannote) before formatting — run once, shared by every
    # fanned-out note. No-op when diarization isn't configured on this server.
    diarize = db.Column(db.Boolean, nullable=False, default=False)
    template_ids = db.Column(db.JSON, nullable=True)
    # The draft note(s) produced — a JSON list, one per template (or one for the
    # raw transcript). All share the audio's transcript_group_id (siblings).
    note_ids = db.Column(db.JSON, nullable=True)

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
