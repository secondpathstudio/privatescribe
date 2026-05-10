"""Re-exports so callers can `from app.models import User, Note, ...`.

Importing this module also forces every model class to be registered on
db.metadata, which db.create_all() and Flask-Migrate's autogenerate rely on.
"""
from app.models.user import User
from app.models.template import Template
from app.models.participant import Participant, note_participants, user_participants
from app.models.note import Note
from app.models.audio_file import AudioFile
from app.models.key_export import KeyExportLog, KeyExportDismissal
from app.models.system_setting import SystemSetting

__all__ = [
    "User",
    "Template",
    "Participant",
    "note_participants",
    "user_participants",
    "Note",
    "AudioFile",
    "KeyExportLog",
    "KeyExportDismissal",
    "SystemSetting",
]
