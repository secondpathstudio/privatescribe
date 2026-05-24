import uuid
from datetime import datetime

from app.extensions import db


class Note(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    author_name = db.Column(db.String(100), nullable=False)
    # User-supplied title for at-a-glance discovery in the notes table.
    # Nullable: when blank the UI falls back to "<template> – <datetime>".
    name = db.Column(db.String(120), nullable=True)
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
    # Manual speaker->identity mapping, layered over note_content_segments.
    # Keys are the "Speaker N" labels merge_segments() produced; values carry
    # the assigned identity. participantId links to a Participant row when the
    # speaker is a saved contact, or is None for a free-text name (a speaker
    # identified after the fact, with no contact on file). name is always set
    # — a denormalized snapshot so the label survives a participant rename or
    # delete, since the note is a point-in-time record. None for un-diarized
    # or unlabeled notes. Editable until the note is approved, then locked
    # alongside the raw transcript:
    #   {"Speaker 1": {"participantId": "<uuid>"|null, "name": "Dr. Jane Smith"}}
    speaker_labels = db.Column(db.JSON, nullable=True)
    # Approval timestamp. Null while the note is in draft (raw transcript
    # editable, highlights visible). Set when the user clicks Approve, at
    # which point the raw transcript becomes immutable forever — the regular
    # update endpoint rejects raw-text changes once this is set. One-way for
    # v1; no un-approve path.
    approved_at = db.Column(db.DateTime, nullable=True)
    # Workflow state: 'draft' -> 'finalized' -> 'signed'. draft<->finalized
    # is reversible; signing is permanent. Once 'signed' the note body is
    # immutable and further content is added only as addenda. Distinct from
    # approved_at (which locks just the raw transcript) — signing implies
    # approval, but the two remain separate axes for pre-feature notes.
    status = db.Column(db.String(20), nullable=False, default='draft')
    # Set when the note is signed. None until then.
    signed_at = db.Column(db.DateTime, nullable=True)
    note_type = db.Column(db.String(50), nullable=False)
    version = db.Column(db.Integer(), nullable=False, default=1)
    is_deleted = db.Column(db.Boolean, default=False)
    is_deleted_timestamp = db.Column(db.DateTime, nullable=True)

    # All notes formatted from the same raw transcript share this id.
    # Singletons get their own UUID; re-transcribes inherit from the source.
    transcript_group_id = db.Column(db.String(36), nullable=True, index=True)

    template_id = db.Column(db.String(36), db.ForeignKey('template.id'), nullable=True)
    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    # Tenant boundary (Phase 8): denormalized from the author's organization so
    # cross-org filtering is a direct indexed column, not a join through user.
    # Nullable for standalone/legacy rows; stamped on insert (services/org_stamp.py).
    organization_id = db.Column(db.String(36), db.ForeignKey('organization.id'), nullable=True, index=True)

    participants = db.relationship('Participant', secondary='note_participants', back_populates='notes')
    # Append-only timestamped entries added after a note is signed. Ordered
    # oldest-first for display. Cascade-delete so trashing a note's row also
    # clears its addenda.
    addenda = db.relationship(
        'NoteAddendum',
        backref='note',
        cascade='all, delete-orphan',
        order_by='NoteAddendum.created_at',
    )

    def __repr__(self):
        return f"<Note {self.id}>"
