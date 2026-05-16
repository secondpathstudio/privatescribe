"""Audio file retention — purge encrypted audio uploads.

Two ways audio gets removed:
  - purge_expired(): deletes audio past the admin-configured retention window,
    measured from AudioFile.created_at (upload time). Driven by the
    `flask purge-audio` CLI command, intended to run on a schedule.
  - purge_all(): deletes every stored audio file at once. Used by the admin
    "delete all prior audio" action when audio storage is turned off.

Each deletion removes the on-disk ciphertext and the AudioFile row. The owning
notes keep their transcript text and transcript_group_id — only the playable
recording goes away.
"""
from datetime import datetime, timedelta
from typing import Optional

from app.extensions import db
from app.models import AudioFile
from app.services import audio_storage, settings as settings_service
from app.services.audit import log_action


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
