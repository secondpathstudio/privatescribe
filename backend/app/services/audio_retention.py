"""Audio file retention — purge encrypted audio uploads.

Ways audio gets removed:
  - purge_expired(): deletes audio past the admin-configured retention window,
    measured from AudioFile.created_at (upload time). Driven by the
    `flask purge-audio` CLI command, intended to run on a schedule.
  - delete_orphaned_audio(): deletes the recording for one transcript group
    once no Note references it — called when a note is permanently deleted.
  - purge_orphaned(): sweeps every audio file no live Note references — the
    backlog of recordings left behind by past note deletes, plus abandoned
    uploads whose transcript never became a note. Driven by the
    `flask purge-orphaned-audio` CLI command.
  - purge_all(): deletes every stored audio file at once. Used by the admin
    "delete all prior audio" action when audio storage is turned off.

Each deletion removes the on-disk ciphertext and the AudioFile row. The owning
notes keep their transcript text and transcript_group_id — only the playable
recording goes away.
"""
from datetime import datetime, timedelta
from typing import Optional

from app.extensions import db
from app.models import AudioFile, Note
from app.services import audio_storage, settings as settings_service
from app.services.audit import log_action

# Grace period before an upload with no transcript_group_id (transcribe ran
# but the user never saved a note) is treated as a sweepable orphan. Keeps the
# sweep from deleting a recording that's mid-flow — uploaded seconds ago, with
# its note about to be saved by POST /api/notes.
ORPHAN_UPLOAD_GRACE = timedelta(hours=24)


def _delete_row(row: AudioFile, *, via: str, user_id: Optional[str] = None) -> None:
    """Drop one AudioFile: remove the on-disk ciphertext, then the DB row.

    delete_file is silent on a missing file, so a row whose file is already
    gone is still reconciled away.
    """
    audio_storage.delete_file(row.stored_filename)
    log_action(
        'audio.delete',
        user_id=user_id,
        resource_type='audio_file',
        resource_id=row.id,
        extra={'via': via, 'transcript_group_id': row.transcript_group_id},
    )
    db.session.delete(row)


def expired_rows() -> list[AudioFile]:
    """AudioFile rows older than the retention window. Empty when retention is
    disabled (audio_retention_days == 0 = keep indefinitely)."""
    days = settings_service.get_audio_retention_days()
    if days <= 0:
        return []
    cutoff = datetime.utcnow() - timedelta(days=days)
    return AudioFile.query.filter(AudioFile.created_at <= cutoff).all()


def purge_expired(*, dry_run: bool = False) -> list[AudioFile]:
    """Delete audio past the retention window. Returns the rows that were
    deleted (or, in dry-run, the rows that would be deleted)."""
    rows = expired_rows()
    if dry_run or not rows:
        return rows
    for row in rows:
        _delete_row(row, via='purge-audio')
    db.session.commit()
    return rows


def delete_orphaned_audio(transcript_group_id: Optional[str], *, via: str,
                          user_id: Optional[str] = None) -> int:
    """Delete the audio for a transcript group once no Note references it.

    Returns the number of audio files deleted. Call this AFTER the owning
    note row has been deleted and flushed from the session, so the orphan
    check no longer sees it. A no-op when:
      - transcript_group_id is falsy (the note had no recording), or
      - a Note still shares the group — including an un-purged trashed
        sibling, which could be restored and would then expect its audio.

    Does not commit; the caller commits alongside the note deletion so the
    note removal and the audio removal land atomically.
    """
    if not transcript_group_id:
        return 0
    still_referenced = (
        Note.query
        .filter_by(transcript_group_id=transcript_group_id)
        .first()
    )
    if still_referenced is not None:
        return 0
    rows = AudioFile.query.filter_by(transcript_group_id=transcript_group_id).all()
    for row in rows:
        _delete_row(row, via=via, user_id=user_id)
    return len(rows)


def orphaned_rows() -> list[AudioFile]:
    """Audio files no live Note references. Two kinds:

      - group orphans: transcript_group_id is set, but every note that
        shared the group has been hard-deleted (the backlog from note
        deletes that predate orphan cleanup).
      - abandoned uploads: transcript_group_id is NULL — transcribe ran but
        the user never saved a note. Only counted once older than
        ORPHAN_UPLOAD_GRACE so an upload still mid-flow is never swept.
    """
    referenced = {
        gid for (gid,) in (
            db.session.query(Note.transcript_group_id)
            .filter(Note.transcript_group_id.isnot(None))
            .distinct()
        )
    }
    cutoff = datetime.utcnow() - ORPHAN_UPLOAD_GRACE
    orphans: list[AudioFile] = []
    for row in AudioFile.query.all():
        if row.transcript_group_id is None:
            if row.created_at <= cutoff:
                orphans.append(row)
        elif row.transcript_group_id not in referenced:
            orphans.append(row)
    return orphans


def purge_orphaned(*, dry_run: bool = False) -> list[AudioFile]:
    """Delete every audio file no live Note references. Returns the rows that
    were deleted (or, in dry-run, the rows that would be deleted)."""
    rows = orphaned_rows()
    if dry_run or not rows:
        return rows
    for row in rows:
        _delete_row(row, via='purge-orphaned-audio')
    db.session.commit()
    return rows


def purge_all(*, user_id: Optional[str] = None) -> int:
    """Delete every stored audio file and its DB row. Returns the count.

    Caller is responsible for committing any settings changes made in the
    same request — this commits the deletions itself.
    """
    rows = AudioFile.query.all()
    for row in rows:
        _delete_row(row, via='admin-purge-all', user_id=user_id)
    db.session.commit()
    return len(rows)
