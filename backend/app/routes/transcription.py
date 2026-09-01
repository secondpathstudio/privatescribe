import json
import logging
import os

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db, limiter
from app.models import AudioFile, Template
from app.services.template_access import template_shared_with_user
from app.security.auth import require_admin
from app.services import audio_storage, ollama_client
from app.services import dictation_markers, settings as settings_service
from app.services import structured_runtime, vocabulary
from app.services.audit import log_action
from app.services.strictness import effective_strictness, level_for
from app.services.diarization import (
    DiarizationUnavailable,
    diarize_path,
    merge_segments,
    relabel_speakers,
    segments_to_text,
)
from app.services import stt
from app.services.whisper import prepare_wav

logger = logging.getLogger(__name__)

bp = Blueprint("transcription", __name__)

# Cheap pre-filter so obvious junk uploads don't even reach ffmpeg. ffmpeg
# still probes the real content; this is just an early, friendly rejection.
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
@limiter.limit("10 per minute")
def transcribe():
    """Stream stage progress as NDJSON.

    Emits one JSON object per line:
      {"stage": "decoding"}                               # ffmpeg/pydub decode to WAV
      {"stage": "transcribing"}                           # Whisper
      {"stage": "transcribing", "progress": 0.0..1.0}     # per-segment progress
      {"stage": "diarizing"}                              # only if diarize=true
      {"stage": "complete", "raw_note": "...", "segments": [...] | null}
      {"stage": "error", "error": "...", "message": "...", "raw_note"?: "..."}

    The HTTP status is always 200 once the stream starts — errors are surfaced
    as inline events because chunked responses can't change status mid-stream.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    diarize = _truthy(request.form.get('diarize', 'true'))
    # Per-note dictation-markers choice. Defaults true to match the previous
    # behavior for clients that don't send the field. Gated below by the
    # admin-wide kill-switch.
    apply_markers_requested = _truthy(request.form.get('apply_dictation_markers', 'true'))
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
        size_bytes: int | None = None
        try:
            # Decoding first — covers the encrypted-save + pydub/ffmpeg WAV
            # conversion. For large non-WAV uploads (mp4, webm) this can run
            # several seconds before Whisper sees a single sample, so the
            # client needs a distinct label here rather than a misleading
            # "Transcribing" with no progress.
            yield json.dumps({"stage": "decoding"}) + "\n"

            # Persist the original upload encrypted to disk before we touch
            # transcription. If the user abandons the form the row is left
            # with transcript_group_id=NULL and can be swept later; if
            # transcription fails the audio is still kept so the user can
            # retry without re-uploading.
            #
            # Gated by the admin audio-storage setting: when storage is off we
            # skip the save entirely, audio_file_id stays None, and the note
            # the user saves later has no playable recording. Transcription
            # itself is unaffected — prepare_wav reads the upload directly.
            file.seek(0)
            if settings_service.get_audio_storage_enabled():
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

            # Audit the transcription unconditionally. The audit row used to
            # be gated behind the audio-storage toggle, which meant that with
            # storage off a user could transcribe PHI with no trace at all.
            # `stored` records whether the encrypted copy was kept; when
            # storage is off there's no AudioFile row, so resource_id is None.
            log_action(
                'audio.transcribe',
                user_id=current_user,
                resource_type='audio_file' if audio_file_id else 'audio',
                resource_id=audio_file_id,
                extra={
                    'stored': audio_file_id is not None,
                    'size_bytes': size_bytes,
                    'mime_type': file.mimetype or None,
                    'diarize': diarize,
                    'max_speakers': max_speakers,
                },
            )
            db.session.commit()

            # Bias Whisper toward the user's effective vocabulary list
            # (admin defaults + user additions). build_whisper_prompt returns
            # None when both lists are empty, in which case we pass nothing
            # and decoding behaves exactly as it did before this feature.
            effective_vocab = vocabulary.get_effective_vocabulary(current_user)
            audio_path = prepare_wav(file)
            # Decoded WAV in hand. Switch the client label to "transcribing"
            # so the progress bar that follows reads against the right stage.
            yield json.dumps({"stage": "transcribing"}) + "\n"
            # Stream per-segment progress (computed from info.duration vs
            # segment.end) so the client can paint a progress bar instead of
            # an indeterminate spinner.
            raw_text: str = ""
            whisper_segments: list = []
            whisper_words: list = []
            for kind, payload in stt.get_engine().transcribe_streaming(
                audio_path,
                initial_prompt=vocabulary.build_whisper_prompt(effective_vocab),
                # Whole-file upload — use the batched pipeline for the ~2-4x
                # speedup. (Live ticks use the engine's blocking transcribe,
                # which stays sequential.)
                batched=True,
            ):
                if kind == "progress":
                    yield json.dumps({
                        "stage": "transcribing",
                        "progress": payload,
                    }) + "\n"
                elif kind == "result":
                    raw_text, whisper_segments, whisper_words = payload

            # Honor spoken dictation commands ("new paragraph", "new line",
            # "period", "comma") before the transcript reaches the LLM or
            # storage. Two gates: the admin-wide kill-switch is checked first
            # (off = nobody can use the feature), then the per-note user
            # toggle. Diarized output is left untouched: speaker-labeled prose
            # is almost always a conversation, not a dictation, and the labels
            # complicate sentence-boundary detection.
            if (
                settings_service.get_dictation_markers_enabled()
                and apply_markers_requested
            ):
                raw_text = dictation_markers.apply_markers(raw_text)

            # Expand abbreviations (admin + user, user-wins-on-conflicts) so
            # the LLM and the stored raw transcript both see long forms.
            # Empty dict short-circuits inside apply_abbreviations.
            raw_text = vocabulary.apply_abbreviations(
                raw_text, vocabulary.get_effective_abbreviations(current_user)
            )

            if not diarize:
                # `words` ride along with the non-diarized payload so the
                # client can highlight low-confidence Whisper output inline.
                # The list still references the ORIGINAL Whisper tokens —
                # dictation markers and abbreviation expansion may have
                # reshaped `raw_text` afterward, so the client does a
                # forward-greedy match to align display tokens to words.
                yield json.dumps({
                    "stage": "complete",
                    "raw_note": raw_text,
                    "segments": None,
                    "words": whisper_words,
                    "audio_file_id": audio_file_id,
                }) + "\n"
                return

            yield json.dumps({"stage": "diarizing"}) + "\n"
            try:
                turns = diarize_path(audio_path, max_speakers=max_speakers)
            except DiarizationUnavailable as e:
                # Same contract as the old 422: client falls back to the raw
                # transcript and surfaces the message. We also include the
                # word list here so the confidence-highlighting view still
                # works on the fallback.
                logger.warning(f"Diarization unavailable: {e}")
                yield json.dumps({
                    "stage": "error",
                    "error": "diarization_unavailable",
                    "message": str(e),
                    "raw_note": raw_text,
                    "words": whisper_words,
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
            logger.error(f"Transcription failure: {type(e).__name__}: {e}")
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
    """Return the models installed in the local Ollama server.

    Each entry carries `size` (bytes on disk) and `loaded` (currently held in
    Ollama's memory, per `ollama ps`). `default` is the active model templates
    fall back to when they don't pin their own.
    """
    try:
        models = ollama_client.list_installed_models()
    except Exception as e:
        logger.error(f"Ollama list failure: {type(e).__name__}: {e}")
        return jsonify({
            "error": "Could not reach Ollama. Make sure `ollama serve` is running.",
            "models": [],
        }), 503

    # Loaded-state is decoration on the list — if `ps` fails (e.g. an older
    # daemon without the endpoint) every model just shows as not loaded.
    try:
        loaded = {
            ollama_client.normalize_tag(m["name"])
            for m in ollama_client.list_loaded_models()
        }
    except Exception as e:
        logger.warning(f"Ollama ps failure: {type(e).__name__}: {e}")
        loaded = set()
    for m in models:
        m["loaded"] = ollama_client.normalize_tag(m["name"]) in loaded

    return jsonify({
        "models": models,
        "default": settings_service.get_llm_model(),
    })


@bp.route('/api/ollama/health', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
def ollama_health():
    """Unauthenticated probe used by the Electron shell at app boot.

    Does a sub-second TCP connect to the Ollama port instead of calling
    `list_installed_models()`. We only need to know "is the daemon up?",
    so we skip parsing the model list every poll. Kept auth-free because
    the check fires before the user has logged in.
    """
    import socket
    host, port = ollama_client.get_host_port()
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return jsonify({"ok": True})
    except OSError as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 503


@bp.route('/api/getMarkdown', methods=['POST'])
@jwt_required()
def get_markdown():
    """Stream the LLM's template-fill output as NDJSON.

    Wire events (one JSON object per line):
      {"stage": "start"}                       — emitted before the first delta
      {"stage": "chunk", "delta": "..."}       — N of these, in order
      {"stage": "complete", "markdown": "..."} — the full joined output
      {"stage": "error", "message": "..."}     — fatal mid-stream error

    Preflight errors (no template, template not found, Ollama unreachable,
    model not installed, no-template "verbatim" path) still return as a
    regular JSON response with 4xx/5xx so the client can branch cleanly
    on them before deciding to read the stream. Once the streaming Response
    is returned the HTTP status is locked at 200 and errors become events.
    """
    request_data = request.get_json(silent=True) or {}
    if not request_data:
        return jsonify({"error": "No JSON data provided"}), 400

    raw_note = request_data.get('raw_note')
    # Rewrite "Speaker N" to the named participants before the LLM sees the
    # transcript, so the formatted note refers to people by name. No-op when
    # the client sends no labels (e.g. the first-pass format at note creation,
    # before speakers have been identified).
    raw_note = relabel_speakers(raw_note, request_data.get('speaker_labels'))
    note_details = request_data.get('note_details', {})

    if not all(k in note_details for k in ('note_date', 'participants')):
        return jsonify({"error": "Missing required fields in note_details"}), 400

    current_user = get_jwt_identity()

    # No template = the user wants the raw transcript saved verbatim. Skip
    # the LLM entirely. Emit as a single-event NDJSON stream so the client
    # has just one success code path (streaming) to handle.
    template_id = note_details.get('template_id')
    if not template_id:
        @stream_with_context
        def verbatim():
            yield json.dumps({"stage": "complete", "markdown": raw_note}) + "\n"
        return Response(verbatim(), mimetype="application/x-ndjson")

    template = Template.query.filter_by(id=template_id, is_deleted=False).first()
    if not template or (
        template.author_id != current_user
        and not template_shared_with_user(template_id, current_user)
    ):
        return jsonify({"error": "Template not found"}), 404

    note_details['author_id'] = current_user
    # Per-note model override (from the create-note model picker) wins over the
    # template's saved model, which in turn falls back to the app-wide default.
    # Whatever this resolves to is validated by the is_model_installed preflight
    # below, so a bogus/uninstalled override surfaces the same clear 422.
    requested_model = (request_data.get('model') or '').strip()
    model_name = requested_model or template.llm_model or settings_service.get_llm_model()

    # Pre-flight: distinguish "Ollama unreachable" (503) from "model not
    # installed" (422). Doing this before the stream opens lets clients
    # surface those errors as normal HTTP failures instead of having to
    # parse an event mid-stream.
    try:
        installed = ollama_client.is_model_installed(model_name)
    except Exception as e:
        logger.warning(f"Ollama unreachable during preflight: {type(e).__name__}: {e}")
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

    @stream_with_context
    def generate():
        try:
            yield json.dumps({"stage": "start"}) + "\n"
            buffer: list[str] = []
            for delta in ollama_client.generate_markdown_stream(
                template, raw_note, note_details, model_name
            ):
                buffer.append(delta)
                yield json.dumps({"stage": "chunk", "delta": delta}) + "\n"
            full_markdown = "".join(buffer)
            yield json.dumps({"stage": "complete", "markdown": full_markdown}) + "\n"

            log_action(
                'markdown.generate',
                user_id=current_user,
                resource_type='template',
                resource_id=template_id,
                extra={'model': model_name, 'mode': 'stream'},
            )
            db.session.commit()
        except Exception as e:
            # Mid-stream failure (Ollama disconnected, timeout, etc). The
            # status code is already 200, so we surface the error inline.
            logger.error(f"Ollama stream failure: {type(e).__name__}: {e}")
            yield json.dumps({
                "stage": "error",
                "message": (
                    "AI formatting failed mid-stream. Make sure Ollama is "
                    "running and the configured model is pulled."
                ),
            }) + "\n"

    return Response(generate(), mimetype="application/x-ndjson")


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
    # Same speaker-name rewrite as /getMarkdown — see the note there.
    raw_note = relabel_speakers(raw_note, body.get('speaker_labels'))
    template_id = body.get('template_id')
    note_details = body.get('note_details') or {}

    if not raw_note or not template_id:
        return jsonify({"error": "raw_note and template_id are required"}), 400

    current_user = get_jwt_identity()
    template = Template.query.filter_by(id=template_id, is_deleted=False).first()
    if not template or (
        template.author_id != current_user
        and not template_shared_with_user(template_id, current_user)
    ):
        return jsonify({"error": "Template not found"}), 404
    if template.template_type != 'structured':
        return jsonify({"error": "Template is not structured; use /api/getMarkdown instead"}), 400
    if not template.structured:
        return jsonify({"error": "Template has no structured payload"}), 400

    # Per-note model override (create-note picker) > template model > app default.
    # Validated by the is_model_installed preflight just below.
    requested_model = (body.get('model') or '').strip()
    model_name = requested_model or template.llm_model or settings_service.get_llm_model()

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
        logger.warning(f"Ollama unreachable during preflight: {type(e).__name__}: {e}")
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
            logger.error(f"Structured run failure: {type(e).__name__}: {e}")
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
            logger.error(f"Ollama pull failure: {type(e).__name__}: {e}")
            yield json.dumps({"error": str(e), "done": True}) + "\n"

    return Response(generate(), mimetype="application/x-ndjson")


@bp.route('/api/ollama/models/<path:model_name>', methods=['DELETE'])
@require_admin
def delete_ollama_model(model_name):
    """Remove an installed model from the Ollama store.

    Guards, in order:
      - 409 when the model is the active default (`llm_model` setting) —
        the admin must switch the default before deleting it.
      - 409 listing template names when any non-deleted template overrides
        its model to this one, unless `?force=1` — the client shows those
        names in a second confirmation and retries with force.

    `<path:...>` (not `<string:...>`) because model names can contain
    slashes (e.g. `hf.co/org/repo:tag`).
    """
    model_name = model_name.strip()
    if not model_name:
        return jsonify({"error": "model is required"}), 400

    normalized = ollama_client.normalize_tag(model_name)
    active = ollama_client.normalize_tag(settings_service.get_llm_model())
    if normalized == active:
        return jsonify({
            "error": "This is the active default model. Choose a different "
                     "default before deleting it.",
        }), 409

    referencing = [
        t.name for t in Template.query.filter(
            Template.llm_model.isnot(None),
            Template.is_deleted.is_(False),
        )
        if ollama_client.normalize_tag(t.llm_model) == normalized
    ]
    if referencing and not _truthy(request.args.get('force')):
        return jsonify({
            "error": "Templates reference this model.",
            "templates": referencing,
        }), 409

    try:
        ollama_client.delete_model(model_name)
    except Exception as e:
        status = getattr(e, 'status_code', None)
        if status == 404:
            return jsonify({"error": f"Model '{model_name}' is not installed."}), 404
        logger.error(f"Ollama delete failure: {type(e).__name__}: {e}")
        return jsonify({
            "error": "Could not reach Ollama. Make sure `ollama serve` is running.",
        }), 503

    log_action(
        'admin.ollama_delete',
        user_id=get_jwt_identity(),
        resource_type='ollama_model',
        resource_id=model_name,
    )
    db.session.commit()
    return jsonify({"ok": True, "deleted": model_name})


def _ollama_memory_op(action: str):
    """Shared body for the load/unload-into-memory endpoints.

    Validates the request, runs the ollama_client call, audit-logs, and maps
    failures the same way the other ollama routes do. `action` is 'load' or
    'unload'.
    """
    data = request.get_json(silent=True) or {}
    model_name = (data.get('model') or '').strip()
    if not model_name:
        return jsonify({"error": "model is required"}), 400
    if len(model_name) > 200:
        return jsonify({"error": "model name too long"}), 400

    # Send the normalized form so untagged input ('tinyllama') hits the same
    # name Ollama lists ('tinyllama:latest') and audit rows stay uniform.
    model_name = ollama_client.normalize_tag(model_name)
    try:
        if not ollama_client.is_model_installed(model_name):
            return jsonify({"error": f"Model '{model_name}' is not installed."}), 404
        if action == 'load':
            ollama_client.load_model(model_name)
        else:
            ollama_client.unload_model(model_name)
    except Exception as e:
        logger.error(f"Ollama {action} failure: {type(e).__name__}: {e}")
        if getattr(e, 'status_code', None) == 404:
            return jsonify({"error": f"Model '{model_name}' is not installed."}), 404
        return jsonify({
            "error": "Could not reach Ollama. Make sure `ollama serve` is running.",
        }), 503

    log_action(
        f'admin.ollama_{action}',
        user_id=get_jwt_identity(),
        resource_type='ollama_model',
        resource_id=model_name,
    )
    db.session.commit()
    return jsonify({"ok": True, "model": model_name})


@bp.route('/api/ollama/load', methods=['POST'])
@require_admin
def load_ollama_model():
    """Load a model into Ollama's memory and pin it (admin RAM control).

    Body: {"model": "name:tag"}. Blocks until the load finishes — a cold
    multi-GB model can take a while, so the client should show a spinner.
    """
    return _ollama_memory_op('load')


@bp.route('/api/ollama/unload', methods=['POST'])
@require_admin
def unload_ollama_model():
    """Evict a model from Ollama's memory immediately.

    Body: {"model": "name:tag"}.
    """
    return _ollama_memory_op('unload')
