"""Stamp organization_id onto new PHI rows at insert (Phase 8 item 2).

Denormalizes the tenant boundary at write time: a ``before_insert`` mapper
event copies the author's organization (or, for audit rows, the actor's) onto
the new row, so every create path gets it without each route having to
remember. The lookup runs on the **flush connection**, never ``db.session``
(which must not be mutated mid-flush).

For ``AuditLog`` this is safe with respect to the tamper-evident hash chain:
``organization_id`` is not one of the fields the entry hash commits to
(``_chain_fields`` in ``services/audit.py``), so setting it during the insert
flush — after the hash is computed — does not affect verification.

``create_app()`` imports this module once so the listeners are registered
before any session activity, mirroring ``note_search``.
"""
from sqlalchemy import event, select

from app.models import (
    AudioFile,
    AuditLog,
    Note,
    NoteAddendum,
    Participant,
    Template,
)
from app.models.user import User

# (model, attribute holding the owning user id). The author-owned PHI models
# stamp from author_id; audit rows stamp from the acting user_id (NULL for
# failed logins / system actions, which then stay org-less — correct).
_STAMP_TARGETS = [
    (Note, "author_id"),
    (Template, "author_id"),
    (Participant, "author_id"),
    (AudioFile, "author_id"),
    (NoteAddendum, "author_id"),
    (AuditLog, "user_id"),
]


def _make_listener(owner_attr: str):
    def _stamp(mapper, connection, target):
        # Respect an org explicitly set by the caller (e.g. a future create
        # path that knows the request's org directly).
        if getattr(target, "organization_id", None):
            return
        owner_id = getattr(target, owner_attr, None)
        if not owner_id:
            return
        org_id = connection.execute(
            select(User.organization_id).where(User.id == owner_id)
        ).scalar()
        if org_id:
            target.organization_id = org_id

    return _stamp


def register() -> None:
    for model, owner_attr in _STAMP_TARGETS:
        event.listen(model, "before_insert", _make_listener(owner_attr))


register()
