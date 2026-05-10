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
    """Stream stage progress as NDJSON.

    Emits one JSON object per line:
      {"stage": "transcribing"}
      {"stage": "diarizing"}                              # only if diarize=true
      {"stage": "complete", "raw_note": "...", "segments": [...] | null}
      {"stage": "error", "error": "...", "message": "...", "raw_note"?: "..."}

    The HTTP status is always 200 once the stream starts — errors are surfaced
    as inline events because chunked responses can't change status mid-stream.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    diarize = _truthy(request.form.get('diarize', 'true'))
    file = request.files['file']

    # Optional speaker-count hint. Frontend sends the participant-list size,
    # which we treat as an upper bound (max_speakers) rather than an exact
    # count — listing 3 participants doesn't guarantee all 3 spoke. Silently
    # drop unparseable / out-of-range values; auto-detect is the safe default.
    max_speakers: int | None = None
    raw_max = request.form.get('max_speakers')
    if raw_max:
        try:
            parsed = int(raw_max)
            if 1 <= parsed <= 20:
                max_speakers = parsed
        except (ValueError, TypeError):
            pass

    @stream_with_context
    def generate():
        # Emit the first stage immediately so the client spinner gets a label
        # before prepare_wav (which can be slow for large non-WAV uploads) runs.
        audio_path = None
        try:
            yield json.dumps({"stage": "transcribing"}) + "\n"
            audio_path = prepare_wav(file)
            raw_text, whisper_segments = transcribe_path(audio_path)

            if not diarize:
                yield json.dumps({
                    "stage": "complete",
                    "raw_note": raw_text,
                    "segments": None,
                }) + "\n"
                return

            yield json.dumps({"stage": "diarizing"}) + "\n"
            try:
                turns = diarize_path(audio_path, max_speakers=max_speakers)
            except DiarizationUnavailable as e:
                # Same contract as the old 422: client falls back to the raw
                # transcript and surfaces the message.
                print(f"Diarization unavailable: {e}")
                yield json.dumps({
                    "stage": "error",
                    "error": "diarization_unavailable",
                    "message": str(e),
                    "raw_note": raw_text,
                }) + "\n"
                return

            merged = merge_segments(whisper_segments, turns)
            labeled_text = segments_to_text(merged) if merged else raw_text
            yield json.dumps({
                "stage": "complete",
                "raw_note": labeled_text,
                "segments": merged,
            }) + "\n"
        except Exception as e:
            print(f"Transcription failure: {type(e).__name__}: {e}")
            yield json.dumps({
                "stage": "error",
                "error": "transcription_failed",
                "message": str(e),
            }) + "\n"
        finally:
            if audio_path:
                try:
                    os.unlink(audio_path)
                except OSError:
                    pass

    return Response(generate(), mimetype="application/x-ndjson")


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
    if not all(k in note_details for k in ('note_date', 'participants')):
        return jsonify({"error": "Missing required fields in note_details"}), 400

    current_user = get_jwt_identity()

    # No template = save the raw transcript verbatim. The user gets a regular
    # note they can edit; we just skip the LLM formatting step.
    template_id = note_details.get('template_id')
    if not template_id:
        return jsonify({"formatted_markdown": raw_note})

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
