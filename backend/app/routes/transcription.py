from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.models import Template
from app.services import ollama_client
from app.services.whisper import transcribe_file

bp = Blueprint("transcription", __name__)


@bp.route('/api/transcribe', methods=['POST'])
@jwt_required()
def transcribe():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    note = transcribe_file(request.files['file'])

    return jsonify({"raw_note": note})


@bp.route('/api/ollama/models', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def list_ollama_models():
    """Return the list of models installed in the local Ollama server."""
    try:
        models = ollama_client.list_installed_models()
    except Exception as e:
        print(f"Ollama list failure: {type(e).__name__}: {e}")
        return jsonify({
            "error": "Could not reach Ollama. Make sure `ollama serve` is running.",
            "models": [],
        }), 503

    return jsonify({
        "models": models,
        "default": ollama_client.DEFAULT_OLLAMA_MODEL,
    })


@bp.route('/api/getMarkdown', methods=['POST'])
@jwt_required()
def get_markdown():
    request_data = request.get_json(silent=True) or {}
    if not request_data:
        return jsonify({"error": "No JSON data provided"}), 400

    raw_note = request_data.get('raw_note')
    note_details = request_data.get('note_details', {})

    # author_id is taken from the JWT, not the client
    if not all(k in note_details for k in ('note_date', 'template_id', 'participants')):
        return jsonify({"error": "Missing required fields in note_details"}), 400

    template_id = note_details.get('template_id')
    if not template_id:
        return jsonify({"error": "Invalid template_id"}), 400

    current_user = get_jwt_identity()
    template = Template.query.filter_by(
        id=template_id,
        author_id=current_user,
        is_deleted=False,
    ).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404

    # Trust the JWT, not the client, for the author identity in the prompt
    note_details['author_id'] = current_user

    print(f"template: {template.content}")

    model_name = template.llm_model or ollama_client.DEFAULT_OLLAMA_MODEL
    print(f"using model: {model_name}")

    try:
        formatted_markdown = ollama_client.generate_markdown(
            template, raw_note, note_details, model_name
        )
    except Exception as e:
        print(f"Ollama failure: {type(e).__name__}: {e}")
        return jsonify({
            "error": "AI formatting unavailable. Make sure Ollama is running and the configured model is pulled.",
            "raw_note": raw_note,
        }), 503

    print("Formatted markdown: " + formatted_markdown)

    return jsonify({"formatted_markdown": formatted_markdown})
