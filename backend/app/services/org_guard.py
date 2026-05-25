"""Defense-in-depth tenant filter on PHI reads (Phase 8 item 7).

Author-scoping already confines these rows to one user (hence one org). This
adds an independent *outer wall*: a ``do_orm_execute`` hook injects
``organization_id == <current org>`` into every ORM SELECT of the author-owned
PHI entities, so even a future query that forgets author-scoping cannot cross
orgs. It's centralized precisely so no individual query has to remember.

Activation is deliberately narrow — otherwise it's a complete no-op, leaving
behavior identical:
  - **server mode only** (standalone has no tenant boundary, stays untouched)
  - an authenticated request whose user is a **non-super-admin with an org**
  - super-admins (span orgs) and CLI/system/no-request contexts (purge jobs,
    backup, prewarm) are exempt

Maintenance-job footgun: because the guard keys on the request context, the
``purge-*`` and ``backup``/``restore`` CLI jobs run operator-wide across every
org (correct — they're a central-IT action). The flip side: any cross-org
maintenance must run as a CLI/system action. If you ever expose such a sweep
through a *request-scoped* admin endpoint, this guard will silently confine it
to the caller's org — route it through a CLI/system path (or a super-admin
context) instead.

Implementation note: the per-request org is memoized on ``g`` and the slot is
seeded to ``None`` *before* the ``User`` load below, so the re-entrant
``do_orm_execute`` for that load short-circuits instead of recursing. ``User``
is not a guarded entity, so it is never itself filtered.
"""
from flask import current_app, g, has_request_context
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import Select, event
from sqlalchemy.orm import Session, with_loader_criteria

from app.deployment import SERVER
from app.extensions import db
from app.models import AudioFile, Job, Note, NoteAddendum, Participant, Template, User
from app.security.auth import is_super_admin

# Author-owned PHI entities that get the outer org wall. User and AuditLog are
# intentionally excluded: their cross-user access is handled explicitly and
# org-scoped in items 4-5, and filtering User here would recurse. Job rides the
# wall too — but only request-context reads are filtered; the worker thread runs
# without a request, so it processes every org's queue (like the CLI jobs).
_GUARDED = (Note, Template, Participant, AudioFile, NoteAddendum, Job)


def _request_org_filter():
    """The org id to confine this request's PHI reads to, or None to skip."""
    if not has_request_context():
        return None
    if current_app.config.get("DEPLOYMENT_MODE") != SERVER:
        return None
    if "_org_filter" in g:
        return g._org_filter
    # Seed first so the User load below (which re-enters this hook) short-circuits.
    g._org_filter = None
    try:
        uid = get_jwt_identity()
    except Exception:
        return None
    if not uid:
        return None
    user = db.session.get(User, uid)
    if user is None or is_super_admin(user):
        return None
    g._org_filter = user.organization_id
    return g._org_filter


@event.listens_for(Session, "do_orm_execute")
def _confine_to_org(execute_state):
    # Only ORM entity SELECTs (a Select); skip column/relationship-internal
    # loads and raw text() executes (the FTS search), which have no .options().
    if not execute_state.is_select or execute_state.is_column_load:
        return
    if not isinstance(execute_state.statement, Select):
        return
    org_id = _request_org_filter()
    if org_id is None:
        return
    for entity in _GUARDED:
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                entity, entity.organization_id == org_id, include_aliases=True
            )
        )
