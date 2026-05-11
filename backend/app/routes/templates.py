from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models import Template
from app.services.audit import diff_fields, log_action

bp = Blueprint("templates", __name__, url_prefix="/api/templates")

TEMPLATE_NAME_MAX = 50
TEMPLATE_CONTENT_MAX = 32_000  # ~8K tokens, fits llama3.2 default context with prompt overhead
TEMPLATE_LLM_MODEL_MAX = 100


@bp.route('', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def create_template():
    data = request.get_json(silent=True) or {}

    if not all(data.get(k) for k in ('name', 'content')):
        return jsonify({"error": "name and content are required"}), 400

    if len(data['name']) > TEMPLATE_NAME_MAX:
        return jsonify({"error": f"Name must be {TEMPLATE_NAME_MAX} characters or fewer"}), 400
    if len(data['content']) > TEMPLATE_CONTENT_MAX:
        return jsonify({"error": f"Content must be {TEMPLATE_CONTENT_MAX} characters or fewer"}), 400

    llm_model = data.get('llmModel') or None
    if llm_model is not None and len(llm_model) > TEMPLATE_LLM_MODEL_MAX:
        return jsonify({"error": f"LLM model must be {TEMPLATE_LLM_MODEL_MAX} characters or fewer"}), 400

    current_user = get_jwt_identity()

    new_template = Template(
        content=data['content'],
        name=data['name'],
        llm_model=llm_model,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        version=1,
        author_id=current_user,
    )

    print('adding template', new_template)

    db.session.add(new_template)
    db.session.flush()
    log_action(
        'template.create',
        user_id=current_user,
        resource_type='template',
        resource_id=new_template.id,
        extra={
            'name': new_template.name,
            'llm_model': new_template.llm_model,
        },
    )
    db.session.commit()

    return jsonify({
        "id": new_template.id,
        "createdAt": new_template.created_at,
        "updatedAt": new_template.updated_at,
        "content": new_template.content,
        "name": new_template.name,
        "llmModel": new_template.llm_model,
        "authorId": new_template.author_id,
        "version": new_template.version,
    }), 201


@bp.route('/user/<string:user_id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_templates_for_user(user_id):
    print("Getting templates for userId: " + user_id)

    current_user = get_jwt_identity()
    if current_user != user_id:
        return jsonify({"error": "Not authorized to access templates for this user"}), 403

    include_deleted = request.args.get('include_deleted', 'false').lower() == 'true'
    query = Template.query.filter_by(author_id=user_id)
    if not include_deleted:
        query = query.filter_by(is_deleted=False)

    templates = query.all()
    if not templates:
        print('no templates found for user', current_user)
        return jsonify([]), 200

    template_list = []

    try:
        for template in templates:
            template_data = {
                "id": template.id,
                "content": template.content,
                "name": template.name,
                "llmModel": template.llm_model,
                "version": template.version,
                "createdAt": template.created_at,
                "updatedAt": template.updated_at,
                "authorId": template.author_id,
                "isDeleted": template.is_deleted,
                "isDeletedTimestamp": template.is_deleted_timestamp,
            }
            template_list.append(template_data)
    except Exception as e:
        print(f"Error getting templates: {str(e)}")
        template_list = []

    return jsonify(template_list)


@bp.route('/<string:id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_template(id):
    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=id, author_id=current_user).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404

    log_action(
        'template.view',
        user_id=current_user,
        resource_type='template',
        resource_id=template.id,
    )
    db.session.commit()

    return jsonify({
        "id": template.id,
        "name": template.name,
        "content": template.content,
        "llmModel": template.llm_model,
        "isDeleted": template.is_deleted,
        "isDeletedTimestamp": template.is_deleted_timestamp,
        "createdAt": template.created_at,
        "updatedAt": template.updated_at,
        "authorId": template.author_id,
        "version": template.version,
    })


@bp.route('/<string:id>', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_template(id):
    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=id, author_id=current_user).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404

    data = request.get_json(silent=True) or {}

    if 'name' in data:
        if not data['name']:
            return jsonify({"error": "Name cannot be empty"}), 400
        if len(data['name']) > TEMPLATE_NAME_MAX:
            return jsonify({"error": f"Name must be {TEMPLATE_NAME_MAX} characters or fewer"}), 400
    if 'content' in data:
        if not data['content']:
            return jsonify({"error": "Content cannot be empty"}), 400
        if len(data['content']) > TEMPLATE_CONTENT_MAX:
            return jsonify({"error": f"Content must be {TEMPLATE_CONTENT_MAX} characters or fewer"}), 400
    if 'llmModel' in data and data['llmModel'] is not None:
        if len(data['llmModel']) > TEMPLATE_LLM_MODEL_MAX:
            return jsonify({"error": f"LLM model must be {TEMPLATE_LLM_MODEL_MAX} characters or fewer"}), 400

    before = {
        'name': template.name,
        'llm_model': template.llm_model,
    }
    before_content = template.content

    template.name = data.get('name', template.name)
    template.content = data.get('content', template.content)
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
    log_action(
        'template.update',
        user_id=current_user,
        resource_type='template',
        resource_id=template.id,
        extra={'changes': diff, 'new_version': template.version},
    )
    db.session.commit()

    return jsonify({
        "id": template.id,
        "createdAt": template.created_at,
        "updatedAt": template.updated_at,
        "content": template.content,
        "name": template.name,
        "llmModel": template.llm_model,
        "authorId": template.author_id,
        "version": template.version,
        "isDeleted": template.is_deleted,
        "isDeletedTimestamp": template.is_deleted_timestamp,
    })


@bp.route('/<string:id>/delete', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def mark_template_as_deleted(id):
    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=id, author_id=current_user).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404
    #TODO add ability for admin to delete any template

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
        "message": "Note added to trash, will be permanently deleted in 30 days",
        "deletedAt": template.is_deleted_timestamp,
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
