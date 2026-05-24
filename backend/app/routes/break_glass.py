"""Break-glass emergency access (GAP-08 · §164.312(a)(2)(ii) Emergency Access).

Notes are strictly author-scoped, so if a clinician is unavailable there is no
ordinary path to their patients' records. This blueprint is the deliberate,
heavily-audited override: an admin can list and read another user's notes in an
emergency.

Guard rails:
  - **admin-only.** An org-admin is confined to their own org (the ORM org-guard
    in services/org_guard.py auto-filters PHI reads to their org); a super-admin
    spans orgs. A redundant explicit ``can_view_org`` check backs that up on this
    sensitive path.
  - **mandatory justification** on every access.
  - **a dedicated, prominent audit event** per access, attributed to the
    *target's* organization (not the actor's) so the affected department's admin
    sees the access in their org-scoped viewer.
  - **read-only.** Break-glass never edits — signed-note integrity is untouched.
"""
from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity

from app.models import Note, User
from app.extensions import db
from app.security.auth import require_admin
from app.security.org_context import can_view_org
from app.services.audit import log_action

bp = Blueprint("break_glass", __name__, url_prefix="/api/admin/break-glass")

# Force a real reason — discourages reflexive one-character justifications.
MIN_JUSTIFICATION = 10


def _read_justification():
    """Return (justification, None) or (None, error_response)."""
    data = request.get_json(silent=True) or {}
    justification = (data.get("justification") or "").strip()
    if len(justification) < MIN_JUSTIFICATION:
        return None, (jsonify({
            "error": f"A justification of at least {MIN_JUSTIFICATION} characters is required for emergency access."
        }), 400)
    return justification, None


@bp.route("/users/<string:user_id>/notes", methods=["POST"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def break_glass_list_notes(user_id):
    """List another user's notes (metadata only) to locate the right record.

    Body: ``{"justification": "..."}``. Returns id/name/status/dates per note;
    full content comes from the per-note read below, which audits separately.
    """
    justification, err = _read_justification()
    if err:
        return err

    actor = User.query.get(get_jwt_identity())
    target = User.query.get(user_id)
    # 404 (not 403) on cross-org so we don't reveal the user exists elsewhere.
    if not target or not can_view_org(actor, target.organization_id):
        return jsonify({"error": "User not found"}), 404

    notes = Note.query.filter_by(author_id=user_id, is_deleted=False).all()

    log_action(
        "note.break_glass_list",
        user_id=actor.id,
        resource_type="user",
        resource_id=target.id,
        organization_id=target.organization_id,
        extra={
            "justification": justification,
            "target_email": target.email,
            "count": len(notes),
        },
    )
    db.session.commit()

    return jsonify({
        "breakGlass": True,
        "targetUserId": target.id,
        "notes": [{
            "id": n.id,
            "name": n.name,
            "status": n.status,
            "noteDate": n.note_date,
            "createdAt": n.created_at,
        } for n in notes],
    })


@bp.route("/notes/<string:note_id>", methods=["POST"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def break_glass_read_note(note_id):
    """Read one note in full via emergency access.

    Body: ``{"justification": "..."}``. Read-only. The org-guard already
    confines an org-admin to notes in their own org; the explicit
    ``can_view_org`` check is a second wall on this sensitive path.
    """
    justification, err = _read_justification()
    if err:
        return err

    actor = User.query.get(get_jwt_identity())
    # No author_id filter — that's the override. The org-guard confines an
    # org-admin to their org (cross-org note -> None -> 404); super-admin spans.
    note = Note.query.filter_by(id=note_id).first()
    if not note or not can_view_org(actor, note.organization_id):
        return jsonify({"error": "Note not found"}), 404

    log_action(
        "note.break_glass_access",
        user_id=actor.id,
        resource_type="note",
        resource_id=note.id,
        organization_id=note.organization_id,
        extra={
            "justification": justification,
            "note_author_id": note.author_id,
            "note_author_name": note.author_name,
        },
    )
    db.session.commit()

    return jsonify({
        "breakGlass": True,
        "id": note.id,
        "name": note.name,
        "status": note.status,
        "noteDate": note.note_date,
        "createdAt": note.created_at,
        "updatedAt": note.updated_at,
        "authorId": note.author_id,
        "authorName": note.author_name,
        "noteContentRaw": note.note_content_raw,
        "noteContentMarkdown": note.note_content_markdown,
        "noteContentSegments": note.note_content_segments,
    })
