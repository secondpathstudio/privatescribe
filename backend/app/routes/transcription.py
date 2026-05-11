import json
import os

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models import AudioFile, Template
from app.security.auth import require_admin
from app.services import audio_storage, ollama_client
from app.services import structured_runtime
from app.services.audit import log_action
from app.services.strictness import effective_strictness, level_for
from app.services.diarization import (
    DiarizationUnavailable,
    diarize_path,
    merge_segments,
    segments_to_text,
)
from app.services.whisper import prepare_wav, transcribe_path

bp = Blueprint("transcription", __name__)

# Cheap pre-filter so junk uploads don't reach pydub/ffmpeg. Matches the format
# hints whisper.prepare_wav trusts (see _FORMAT_HINT_ALLOWLIST there).
_AUDIO_UPLOAD_EXTS = {
    'wav', 'mp3', 'm4a', 'mp4', 'ogg', 'opus', 'webm', 'flac', 'aac',
}
_AUDIO_UPLOAD_MIMES = {
    'video/webm',  # MediaRecorder default
    'video/mp4',   # m4a-in-mp4 containers
}


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def _is_allowed_audio_upload(file) -> bool:
    name = (file.filename or '').lower()
    ext = name.rsplit('.', 1)[-1] if '.' in name else ''
    if ext in _AUDIO_UPLOAD_EXTS:
        return True
    mime = (file.mimetype or '').lower()
    return mime.startswith('audio/') or mime in _AUDIO_UPLOAD_MIMES


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
    if not _is_allowed_audio_upload(file):
        return jsonify({"error": "Unsupported file type. Upload an audio file."}), 415
    current_user = get_jwt_identity()

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
        audio_file_id: str | None = None
        stored_filename: str | None = None
        try:
            yield json.dumps({"stage": "transcribing"}) + "\n"

            # Persist the original upload encrypted to disk before we touch
            # transcription. If the user abandons the form the row is left
            # with transcript_group_id=NULL and can be swept later; if
            # transcription fails the audio is still kept so the user can
            # retry without re-uploading.
            file.seek(0)
            stored_filename, size_bytes = audio_storage.save_encrypted(file.stream)
            audio_row = AudioFile(
                author_id=current_user,
                original_filename=(file.filename or 'recording.webm')[:512],
                stored_filename=stored_filename,
                mime_type=(file.mimetype or None),
                size_bytes=size_bytes,
            )
            db.session.add(audio_row)
            db.session.flush()
            audio_file_id = audio_row.id
            log_action(
                'audio.transcribe',
                user_id=current_user,
                resource_type='audio_file',
                resource_id=audio_file_id,
                extra={
                    'size_bytes': size_bytes,
                    'mime_type': audio_row.mime_type,
                    'diarize': diarize,
                    'max_speakers': max_speakers,
                },
            )
            db.session.commit()

            audio_path = prepare_wav(file)
            raw_text, whisper_segments = transcribe_path(audio_path)

            if not diarize:
                yield json.dumps({
                    "stage": "complete",
                    "raw_note": raw_text,
                    "segments": None,
                    "audio_file_id": audio_file_id,
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
                    "audio_file_id": audio_file_id,
                }) + "\n"
                return

            merged = merge_segments(whisper_segments, turns)
            labeled_text = segments_to_text(merged) if merged else raw_text
            yield json.dumps({
                "stage": "complete",
                "raw_note": labeled_text,
                "segments": merged,
                "audio_file_id": audio_file_id,
            }) + "\n"
        except Exception as e:
            print(f"Transcription failure: {type(e).__name__}: {e}")
            yield json.dumps({
                "stage": "error",
                "error": "transcription_failed",
                "message": str(e),
                "audio_file_id": audio_file_id,
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

    log_action(
        'markdown.generate',
        user_id=current_user,
        resource_type='template',
        resource_id=template_id,
        extra={'model': model_name},
    )
    db.session.commit()

    return jsonify({"formatted_markdown": formatted_markdown})


def _structured_mode_for_template(template: Template) -> str:
    """Decide single-call vs per-field for the whole template run.

    If any field's effective strictness lands in a per-field mode (Careful or
    Strict), the whole template runs per-field so that mixed-strictness
    templates respect the most-strict field's requirement. Otherwise
    single-call. This matches the principle in Studio's UX: strictness is
    a per-field knob that promotes the run shape if any field demands it.
    """
    structured = template.structured or {}
    template_strictness = structured.get('strictness', 50)
    for section in structured.get('sections') or []:
        for field in section.get('fields') or []:
            eff = effective_strictness(field, template_strictness)
            if level_for(eff).runtime.mode == 'per-field':
                return 'per-field'
    return 'single-call'


@bp.route('/api/notes/run-structured', methods=['POST'])
@jwt_required()
def run_structured():
    """Execute a structured (Studio) template against a transcript.

    Streams NDJSON events so the client can render per-field progress for the
    per-field mode. Single-call mode still emits one final `complete` event
    after the underlying Ollama call returns, so the frontend doesn't need to
    branch on mode — it just consumes the stream.

    Request: {"raw_note": str, "template_id": str, "note_details": dict}
    Stream events:
      {"stage": "started", "mode": "single-call" | "per-field", "fieldCount": int}
      (per-field mode only:)
        {"stage": "field_start",    "fieldId", "label", "variableKey"}
        {"stage": "field_complete", "fieldId", "value", "confidence", "flagged", "latencyMs"}
        {"stage": "field_skipped",  "fieldId", "reason"}
        {"stage": "field_error",    "fieldId", "message"}
      {"stage": "complete", "markdown": str}
      {"stage": "error", "message": str}  (terminal)
    """
    body = request.get_json(silent=True) or {}
    raw_note = body.get('raw_note')
    template_id = body.get('template_id')
    note_details = body.get('note_details') or {}

    if not raw_note or not template_id:
        return jsonify({"error": "raw_note and template_id are required"}), 400

    current_user = get_jwt_identity()
    template = Template.query.filter_by(
        id=template_id,
        author_id=current_user,
        is_deleted=False,
    ).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404
    if template.template_type != 'structured':
        return jsonify({"error": "Template is not structured; use /api/getMarkdown instead"}), 400
    if not template.structured:
        return jsonify({"error": "Template has no structured payload"}), 400

    model_name = template.llm_model or ollama_client.DEFAULT_OLLAMA_MODEL

    # Preflight model availability so the operator sees the same clear error
    # the single-call /api/getMarkdown surfaces, rather than failing mid-stream.
    try:
        if not ollama_client.is_model_installed(model_name):
            return jsonify({
                "error": "model_not_installed",
                "model": model_name,
                "message": (
                    f"The model '{model_name}' assigned to template '{template.name}' is "
                    f"not installed. Run `ollama pull {model_name}` (or use the admin "
                    f"Models page) before this template can be used."
                ),
            }), 422
    except Exception as e:
        print(f"Ollama unreachable during preflight: {type(e).__name__}: {e}")
        return jsonify({
            "error": "AI formatting unavailable. Make sure Ollama is running.",
        }), 503

    mode = _structured_mode_for_template(template)
    structured = template.structured
    template_strictness = structured.get('strictness', 50)
    field_count = sum(
        len(s.get('fields') or []) for s in (structured.get('sections') or [])
    )

    log_action(
        'markdown.generate',
        user_id=current_user,
        resource_type='template',
        resource_id=template_id,
        extra={
            'model': model_name,
            'mode': mode,
            'template_type': 'structured',
            'field_count': field_count,
        },
    )
    db.session.commit()

    @stream_with_context
    def generate():
        try:
            yield json.dumps({
                "stage": "started",
                "mode": mode,
                "fieldCount": field_count,
            }) + "\n"

            if mode == 'single-call':
                # Reuse the existing single-pass pipeline. Compile the field
                # tree to a markdown skeleton with {{instructions}} and route
                # it through generate_markdown unchanged.
                from types import SimpleNamespace
                skeleton = structured_runtime.compile_to_skeleton(structured)
                fake_template = SimpleNamespace(name=template.name, content=skeleton)
                details = dict(note_details)
                details['author_id'] = current_user
                raw_markdown = ollama_client.generate_markdown(
                    fake_template, raw_note, details, model_name
                )
                # llama 3.2 sometimes echoes the ###TEMPLATE### framing tokens
                # from the system prompt. Strip them so the user never sees
                # the prompt scaffolding.
                markdown = structured_runtime.sanitize_single_call_output(raw_markdown)
                yield json.dumps({"stage": "complete", "markdown": markdown}) + "\n"
                return

            # per-field mode
            for event in structured_runtime.run_per_field(
                structured=structured,
                transcript=raw_note,
                model_name=model_name,
                template_strictness=template_strictness,
            ):
                # Rewrite the internal `kind` -> wire `stage` for consistency
                # with /api/transcribe's NDJSON convention.
                kind = event.pop('kind')
                wire_event = {"stage": kind, **event}
                yield json.dumps(wire_event) + "\n"

        except Exception as e:
            print(f"Structured run failure: {type(e).__name__}: {e}")
            yield json.dumps({"stage": "error", "message": str(e)}) + "\n"

    return Response(generate(), mimetype="application/x-ndjson")


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

    log_action(
        'admin.ollama_pull',
        user_id=get_jwt_identity(),
        resource_type='ollama_model',
        resource_id=model_name,
    )
    db.session.commit()

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
