import json
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models import Role, Template
from app.security.auth import require_admin
from app.services import settings as settings_service
from app.services.audit import diff_fields, log_action
from app.services.template_access import shared_template_ids_for_user, template_shared_with_user

bp = Blueprint("templates", __name__, url_prefix="/api/templates")

TEMPLATE_NAME_MAX = 50
TEMPLATE_CONTENT_MAX = 32_000  # ~8K tokens, fits llama3.2 default context with prompt overhead
TEMPLATE_LLM_MODEL_MAX = 100
# Structured templates ship a field tree as JSON. Cap the serialized size so a
# malicious client can't store a multi-MB blob; a normal template with ~50
# fields fits well under this.
TEMPLATE_STRUCTURED_MAX_BYTES = 256 * 1024
VALID_TEMPLATE_TYPES = ('simple', 'structured')

# Field types the Studio builder produces. Keep in sync with the builder's
# types/template.ts. Unknown types reject — better to fail-loud on a Studio
# version drift than silently accept a field the runtime can't render.
ALLOWED_FIELD_TYPES = {
    'text', 'paragraph', 'dropdown', 'checklist', 'bullets', 'date', 'number',
}
REQUIRED_FIELD_KEYS = (
    'id', 'type', 'label', 'variableKey', 'required', 'autoFill', 'showInSummary',
)


def _validate_structured(value):
    """JSON-serializability + size cap. Called for any non-null structured payload."""
    if value is None:
        return True, None
    if not isinstance(value, (dict, list)):
        return False, "structured must be a JSON object or array"
    try:
        encoded = json.dumps(value)
    except (TypeError, ValueError):
        return False, "structured must be JSON-serializable"
    if len(encoded.encode('utf-8')) > TEMPLATE_STRUCTURED_MAX_BYTES:
        return False, f"structured payload exceeds {TEMPLATE_STRUCTURED_MAX_BYTES} bytes"
    return True, None


def _validate_structured_shape(value):
    """Shape-check a Studio template tree. Returns an error string or None.

    Liberal in what it accepts — unknown extra keys at any level pass through
    so the builder can ship new optional fields without breaking imports.
    Strict on the bits the runtime depends on (sections list, field type,
    boolean flags, etc.) so a wrong-file paste fails loudly at write time
    instead of crashing during note generation.
    """
    if not isinstance(value, dict):
        return "structured must be an object"
    sections = value.get('sections')
    if not isinstance(sections, list):
        return "structured.sections must be a list"
    if not sections:
        return "structured.sections must contain at least one section"
    for si, section in enumerate(sections):
        if not isinstance(section, dict):
            return f"sections[{si}] must be an object"
        if not isinstance(section.get('id'), str) or not section['id']:
            return f"sections[{si}].id must be a non-empty string"
        if not isinstance(section.get('title'), str):
            return f"sections[{si}].title must be a string"
        fields = section.get('fields')
        if not isinstance(fields, list):
            return f"sections[{si}].fields must be a list"
        for fi, field in enumerate(fields):
            prefix = f"sections[{si}].fields[{fi}]"
            if not isinstance(field, dict):
                return f"{prefix} must be an object"
            for key in REQUIRED_FIELD_KEYS:
                if key not in field:
                    return f"{prefix} missing required key '{key}'"
            if field['type'] not in ALLOWED_FIELD_TYPES:
                return f"{prefix}.type must be one of {sorted(ALLOWED_FIELD_TYPES)}"
            for str_key in ('id', 'label', 'variableKey'):
                if not isinstance(field[str_key], str) or not field[str_key]:
                    return f"{prefix}.{str_key} must be a non-empty string"
            for bool_key in ('required', 'autoFill', 'showInSummary'):
                if not isinstance(field[bool_key], bool):
                    return f"{prefix}.{bool_key} must be a boolean"
            so = field.get('strictnessOverride')
            if so is not None and (not isinstance(so, int) or isinstance(so, bool) or not 0 <= so <= 100):
                return f"{prefix}.strictnessOverride must be an integer 0-100"
    s = value.get('strictness')
    if s is not None and (not isinstance(s, int) or isinstance(s, bool) or not 0 <= s <= 100):
        return "structured.strictness must be an integer 0-100"
    return None


def _serialize_template(t: Template) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "templateType": t.template_type,
        "content": t.content,
        "structured": t.structured,
        "llmModel": t.llm_model,
        "version": t.version,
        "createdAt": t.created_at,
        "updatedAt": t.updated_at,
        "authorId": t.author_id,
        "isDeleted": t.is_deleted,
        "isDeletedTimestamp": t.is_deleted_timestamp,
        "sharedRoles": [{"id": r.id, "name": r.name} for r in t.shared_roles],
    }


@bp.route('', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def create_template():
    data = request.get_json(silent=True) or {}

    if not data.get('name'):
        return jsonify({"error": "name is required"}), 400
    if len(data['name']) > TEMPLATE_NAME_MAX:
        return jsonify({"error": f"Name must be {TEMPLATE_NAME_MAX} characters or fewer"}), 400

    template_type = data.get('templateType', 'simple')
    if template_type not in VALID_TEMPLATE_TYPES:
        return jsonify({"error": f"templateType must be one of {VALID_TEMPLATE_TYPES}"}), 400

    content = data.get('content')
    structured = data.get('structured')

    # Per-type requirements. Simple templates need a content skeleton because
    # /api/getMarkdown expects one; structured templates need a tree because
    # the (future) structured runtime expects one. Both can carry the other
    # field optionally for forward/backward compat.
    if template_type == 'simple':
        if not content:
            return jsonify({"error": "content is required for simple templates"}), 400
    else:  # structured
        if not structured:
            return jsonify({"error": "structured is required for structured templates"}), 400

    if content is not None:
        if len(content) > TEMPLATE_CONTENT_MAX:
            return jsonify({"error": f"Content must be {TEMPLATE_CONTENT_MAX} characters or fewer"}), 400

    ok, err = _validate_structured(structured)
    if not ok:
        return jsonify({"error": err}), 400
    if template_type == 'structured':
        shape_err = _validate_structured_shape(structured)
        if shape_err:
            return jsonify({"error": shape_err}), 400

    llm_model = data.get('llmModel') or None
    if llm_model is not None and len(llm_model) > TEMPLATE_LLM_MODEL_MAX:
        return jsonify({"error": f"LLM model must be {TEMPLATE_LLM_MODEL_MAX} characters or fewer"}), 400

    current_user = get_jwt_identity()

    new_template = Template(
        name=data['name'],
        template_type=template_type,
        content=content,
        structured=structured,
        llm_model=llm_model,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        version=1,
        author_id=current_user,
    )

    db.session.add(new_template)
    db.session.flush()
    log_action(
        'template.create',
        user_id=current_user,
        resource_type='template',
        resource_id=new_template.id,
        extra={
            'name': new_template.name,
            'template_type': new_template.template_type,
            'llm_model': new_template.llm_model,
        },
    )
    db.session.commit()

    return jsonify(_serialize_template(new_template)), 201


@bp.route('/user/<string:user_id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_templates_for_user(user_id):
    current_user = get_jwt_identity()
    if current_user != user_id:
        return jsonify({"error": "Not authorized to access templates for this user"}), 403

    include_deleted = request.args.get('include_deleted', 'false').lower() == 'true'

    # The user's own templates — their trash included only when asked.
    own_query = Template.query.filter_by(author_id=user_id)
    if not include_deleted:
        own_query = own_query.filter_by(is_deleted=False)
    own = own_query.all()

    # Plus templates shared with a role this user holds — owned by someone
    # else, never deleted (include_deleted only governs the user's own trash).
    shared = (
        Template.query
        .filter(
            Template.id.in_(shared_template_ids_for_user(user_id)),
            Template.author_id != user_id,
            Template.is_deleted.is_(False),
        )
        .all()
    )

    return jsonify([_serialize_template(t) for t in own + shared])


@bp.route('/<string:id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_template(id):
    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=id).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404
    if template.author_id != current_user:
        # A non-owner may view a template only while it's actively shared with
        # one of their roles. 404 (not 403) so we don't reveal its existence.
        if template.is_deleted or not template_shared_with_user(id, current_user):
            return jsonify({"error": "Template not found"}), 404

    log_action(
        'template.view',
        user_id=current_user,
        resource_type='template',
        resource_id=template.id,
    )
    db.session.commit()

    return jsonify(_serialize_template(template))


@bp.route('/<string:id>', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_template(id):
    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=id, author_id=current_user).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404

    # Soft-deleted templates are in the trash — editing one would bump
    # updated_at/version while leaving is_deleted=True, an incoherent state.
    # The caller must restore it (PUT /<id>/restore) before editing.
    if template.is_deleted:
        return jsonify({"error": "Template is deleted; restore it before editing"}), 409

    data = request.get_json(silent=True) or {}

    # Type conversions are intentionally not supported. A template's wire
    # format (markdown skeleton vs structured tree) is fundamental to how
    # it's rendered and run — silently flipping it on update would surprise
    # callers more than help them.
    if 'templateType' in data and data['templateType'] != template.template_type:
        return jsonify({"error": "templateType cannot be changed after creation"}), 400

    if 'name' in data:
        if not data['name']:
            return jsonify({"error": "Name cannot be empty"}), 400
        if len(data['name']) > TEMPLATE_NAME_MAX:
            return jsonify({"error": f"Name must be {TEMPLATE_NAME_MAX} characters or fewer"}), 400
    if 'content' in data and data['content'] is not None:
        if not data['content'] and template.template_type == 'simple':
            return jsonify({"error": "Content cannot be empty for simple templates"}), 400
        if len(data['content']) > TEMPLATE_CONTENT_MAX:
            return jsonify({"error": f"Content must be {TEMPLATE_CONTENT_MAX} characters or fewer"}), 400
    if 'structured' in data:
        if template.template_type != 'structured' and data['structured'] is not None:
            return jsonify({"error": "structured field is only valid on structured templates"}), 400
        if template.template_type == 'structured' and not data['structured']:
            return jsonify({"error": "structured cannot be empty for structured templates"}), 400
        ok, err = _validate_structured(data['structured'])
        if not ok:
            return jsonify({"error": err}), 400
        if template.template_type == 'structured' and data['structured'] is not None:
            shape_err = _validate_structured_shape(data['structured'])
            if shape_err:
                return jsonify({"error": shape_err}), 400
    if 'llmModel' in data and data['llmModel'] is not None:
        if len(data['llmModel']) > TEMPLATE_LLM_MODEL_MAX:
            return jsonify({"error": f"LLM model must be {TEMPLATE_LLM_MODEL_MAX} characters or fewer"}), 400

    before = {
        'name': template.name,
        'llm_model': template.llm_model,
    }
    before_content = template.content
    before_structured = template.structured

    template.name = data.get('name', template.name)
    if 'content' in data:
        template.content = data['content']
    if 'structured' in data:
        template.structured = data['structured']
    if 'llmModel' in data:
        template.llm_model = data['llmModel'] or None
    template.updated_at = datetime.utcnow()
    template.version = template.version + 1

    diff = diff_fields(
        before,
        {'name': template.name, 'llm_model': template.llm_model},
    )
    if before_content != template.content:
        diff['content'] = {'changed': True}
    if before_structured != template.structured:
        diff['structured'] = {'changed': True}
    log_action(
        'template.update',
        user_id=current_user,
        resource_type='template',
        resource_id=template.id,
        extra={'changes': diff, 'new_version': template.version},
    )
    db.session.commit()

    return jsonify(_serialize_template(template))


@bp.route('/<string:id>/roles', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def set_template_roles(id):
    """Share a template with a set of roles (replace semantics). Admin-only,
    and the template must belong to the calling admin. Users who hold one of
    those roles then see the template, read-only."""
    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=id, author_id=current_user).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404
    if template.is_deleted:
        return jsonify({"error": "Template is deleted; restore it before sharing"}), 409

    data = request.get_json(silent=True) or {}
    role_ids = data.get('roleIds')
    if not isinstance(role_ids, list):
        return jsonify({"error": "roleIds must be a list"}), 400

    roles = Role.query.filter(Role.id.in_(role_ids)).all()
    template.shared_roles = roles
    template.updated_at = datetime.utcnow()
    log_action(
        'template.share',
        user_id=current_user,
        resource_type='template',
        resource_id=template.id,
        extra={'role_ids': [r.id for r in roles], 'role_names': [r.name for r in roles]},
    )
    db.session.commit()

    return jsonify(_serialize_template(template)), 200


@bp.route('/<string:id>/delete', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def mark_template_as_deleted(id):
    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=id, author_id=current_user).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404
    #TODO add ability for admin to delete any template

    # Idempotent: only stamp the trash timer on the active -> deleted
    # transition. Replaying the call on an already-trashed template must not
    # reset the retention clock (otherwise the purge date keeps sliding).
    if not template.is_deleted:
        template.is_deleted = True
        template.is_deleted_timestamp = datetime.utcnow()
        template.updated_at = datetime.utcnow()

        log_action(
            'template.delete_soft',
            user_id=current_user,
            resource_type='template',
            resource_id=template.id,
        )
        db.session.commit()

    return jsonify({
        "id": template.id,
        "message": "Template moved to trash.",
        "deletedAt": template.is_deleted_timestamp,
        "retentionDays": settings_service.get_trash_retention_days(),
        "autoPurge": settings_service.get_trash_auto_purge(),
    })


@bp.route('/<string:id>/delete-permanently', methods=['DELETE'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def delete_template(id):
    """Hard-delete a template. Notes that referenced it keep their already-
    generated content; SQLAlchemy nulls out their template_id on delete.

    Two guards: the template must already be in the trash (purging is a
    two-step confirm so a misclick can't vaporize a template that's still in
    use), and the org's trash-retention window must have elapsed.
    """
    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=id, author_id=current_user).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404
    #TODO add ability for admin to delete any template
    if not template.is_deleted:
        return jsonify({"error": "Template must be in the trash before it can be permanently deleted"}), 409
    blocked = settings_service.trash_purge_block_reason(template.is_deleted_timestamp, noun="template")
    if blocked:
        return jsonify({"error": blocked}), 409

    log_action(
        'template.delete_permanent',
        user_id=current_user,
        resource_type='template',
        resource_id=template.id,
    )
    db.session.delete(template)
    db.session.commit()

    return jsonify({
        "id": id,
        "message": "Template permanently deleted.",
    })


@bp.route('/<string:id>/restore', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def mark_template_as_restored(id):
    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=id, author_id=current_user).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404
    #TODO add ability for admin to restore any template

    template.is_deleted = False
    template.is_deleted_timestamp = None
    template.updated_at = datetime.utcnow()

    log_action(
        'template.restore',
        user_id=current_user,
        resource_type='template',
        resource_id=template.id,
    )
    db.session.commit()

    return jsonify({
        "id": template.id,
        "message": "Template restored successfully.",
    })
