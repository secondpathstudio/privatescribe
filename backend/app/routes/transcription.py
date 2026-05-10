import json
import os

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.models import Template
from app.security.auth import require_admin
from app.services import ollama_client
from app.services.diarization import (
    DiarizationUnavailable,
    diarize_path,
    merge_segments,
    segments_to_text,
)
from app.services.whisper import prepare_wav, transcribe_path

bp = Blueprint("transcription", __name__)


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


@bp.route('/api/transcribe', methods=['POST'])
@jwt_required()
def transcribe():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    diarize = _truthy(request.form.get('diarize', 'true'))

    audio_path = prepare_wav(request.files['file'])
    try:
        raw_text, whisper_segments = transcribe_path(audio_path)

        if not diarize:
            return jsonify({"raw_note": raw_text, "segments": None})

        try:
            turns = diarize_path(audio_path)
        except DiarizationUnavailable as e:
            # Surface a 422 so the client can decide whether to retry without
            # diarization or alert an admin. Returning the raw transcript would
            # silently swallow the user's "identify speakers" choice.
            print(f"Diarization unavailable: {e}")
            return jsonify({
                "error": "diarization_unavailable",
                "message": str(e),
                "raw_note": raw_text,
            }), 422

        merged = merge_segments(whisper_segments, turns)
        labeled_text = segments_to_text(merged) if merged else raw_text
        return jsonify({"raw_note": labeled_text, "segments": merged})
    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            pass


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

    # Pre-flight: distinguish "Ollama unreachable" (503) from "model not
    # installed" (422). Without this, both fall through to a generic 503 from
    # the chat() call and the operator can't tell which they need to fix.
    try:
        installed = ollama_client.is_model_installed(model_name)
    except Exception as e:
        print(f"Ollama unreachable during preflight: {type(e).__name__}: {e}")
        return jsonify({
            "error": "AI formatting unavailable. Make sure Ollama is running.",
            "raw_note": raw_note,
        }), 503

    if not installed:
        return jsonify({
            "error": "model_not_installed",
            "model": model_name,
            "message": (
                f"The model '{model_name}' assigned to template '{template.name}' is not "
                f"installed. An admin must run `ollama pull {model_name}` (or use the "
                f"admin Models page) before this template can be used."
            ),
            "raw_note": raw_note,
        }), 422

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


@bp.route('/api/ollama/pull', methods=['POST'])
@require_admin
def pull_ollama_model():
    """Stream `ollama pull <model>` progress to an admin client as NDJSON.

    Each line of the response body is a JSON object with at minimum a
    `status` field; download chunks also include `digest`, `total`,
    `completed`. The final line is `{"status":"success","done":true}` on
    success or `{"error": "...","done":true}` on failure. The connection
    stays open for the duration of the pull (potentially many minutes for
    multi-GB models), so the client should consume the stream incrementally.
    """
    data = request.get_json(silent=True) or {}
    model_name = (data.get('model') or '').strip()
    if not model_name:
        return jsonify({"error": "model is required"}), 400
    # Reasonable upper bound. Ollama tags themselves can be ~80 chars.
    if len(model_name) > 200:
        return jsonify({"error": "model name too long"}), 400

    @stream_with_context
    def generate():
        try:
            for progress in ollama_client.pull_model_stream(model_name):
                yield json.dumps(progress) + "\n"
            yield json.dumps({"status": "success", "done": True}) + "\n"
        except Exception as e:
            print(f"Ollama pull failure: {type(e).__name__}: {e}")
            yield json.dumps({"error": str(e), "done": True}) + "\n"

    return Response(generate(), mimetype="application/x-ndjson")
