"""Re-exports so callers can `from app.models import User, Note, ...`.

Importing this module also forces every model class to be registered on
db.metadata, which db.create_all() and Flask-Migrate's autogenerate rely on.
"""
from app.models.user import User
from app.models.organization import Organization
from app.models.template import Template
from app.models.role import Role, user_roles, template_roles
from app.models.participant import Participant, note_participants, user_participants
from app.models.note import Note
from app.models.note_addendum import NoteAddendum
from app.models.audio_file import AudioFile
from app.models.key_export import KeyExportLog, KeyExportDismissal
from app.models.system_setting import SystemSetting
from app.models.audit_log import AuditLog
from app.models.session import Session

__all__ = [
    "User",
    "Organization",
    "Template",
    "Role",
    "user_roles",
    "template_roles",
    "Participant",
    "note_participants",
    "user_participants",
    "Note",
    "NoteAddendum",
    "AudioFile",
    "KeyExportLog",
    "KeyExportDismissal",
    "SystemSetting",
    "AuditLog",
    "Session",
]
