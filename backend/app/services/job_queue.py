"""Background job queue (Phase 13) — a single in-process worker thread.

A `Job` row is enqueued (from an uploaded AudioFile); this worker claims the
oldest queued job, runs the transcription pipeline (Whisper → optional LLM
format), writes a *draft* Note, and marks the job done. One worker, processing
serially, so a batch of recordings (e.g. a day off a portable recorder) drains
without holding a streaming HTTP request per file and without thrashing the
CPU-only model. Transcription serializes against live requests through
`whisper.inference_lock`.

No Redis: the queue is the `job` table and the worker lives in the backend
daemon, so it survives logout/reboot with the daemon. Postgres later changes
only the table's engine.
"""
import logging
import threading
import time
from datetime import datetime

logger = logging.getLogger(__name__)

POLL_INTERVAL_SEC = 2.0

_started = False
_start_lock = threading.Lock()
_wake = threading.Event()


def enqueue_transcription(author_id, audio_file_id, *, template_ids=None, label=None):
    """Create a queued transcription job and wake the worker. Returns the Job.

    `template_ids` is the (possibly empty) list of simple templates to format
    the single transcript through — one draft note per template, or one raw
    note when empty. Caller commits (so AudioFile + Job land together).
    """
    from app.extensions import db
    from app.models import Job

    job = Job(
        author_id=author_id,
        type="transcription",
        status=Job.STATUS_QUEUED,
        audio_file_id=audio_file_id,
        template_ids=list(template_ids) if template_ids else None,
        label=(label or None),
        progress=0,
    )
    db.session.add(job)
    # The worker polls anyway; this just shortens the latency to pickup.
    _wake.set()
    return job


def start_worker(app):
    """Start the single worker thread (idempotent). Call once from create_app."""
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
    t = threading.Thread(target=_worker_loop, args=(app,), daemon=True, name="job-worker")
    t.start()
    logger.info("Job worker started.")


def _worker_loop(app):
    while True:
        try:
            processed = _run_one(app)
        except Exception as e:  # never let the loop die
            logger.exception("Job worker iteration crashed: %s", e)
            processed = False
        if not processed:
            # Sleep until woken by an enqueue or the poll interval elapses.
            _wake.wait(POLL_INTERVAL_SEC)
            _wake.clear()


def _run_one(app) -> bool:
    """Claim and process one queued job. Returns True if a job was handled."""
    from app.extensions import db
    from app.models import Job

    with app.app_context():
        job = (
            Job.query.filter_by(status=Job.STATUS_QUEUED, type="transcription")
            .order_by(Job.created_at.asc())
            .first()
        )
        if job is None:
            return False
        # Single worker → no claim race; mark running so the queue UI reflects it.
        job.status = Job.STATUS_RUNNING
        job.started_at = datetime.utcnow()
        job.attempts = (job.attempts or 0) + 1
        job.stage = "starting"
        job.progress = 0
        db.session.commit()
        job_id = job.id

    # Process outside the claim transaction; its own context manages the session.
    try:
        _process_transcription(app, job_id)
    except Exception as e:
        logger.exception("Job %s failed: %s", job_id, e)
        _mark_failed(app, job_id, str(e))
    return True


def _mark_failed(app, job_id, message):
    from app.extensions import db
    from app.models import Job

    with app.app_context():
        try:
            job = db.session.get(Job, job_id)
            if job is not None:
                job.status = Job.STATUS_FAILED
                job.error_text = (message or "")[:2000]
                job.finished_at = datetime.utcnow()
                db.session.commit()
        except Exception:
            db.session.rollback()
            logger.exception("Could not mark job %s failed", job_id)


def _process_transcription(app, job_id):
    import os
    import tempfile
    import uuid

    from app.extensions import db
    from app.models import AudioFile, Job, Note, Template, User
    from app.services import audio_storage, dictation_markers, ollama_client
    from app.services import settings as settings_service
    from app.services import vocabulary, whisper

    with app.app_context():
        job = db.session.get(Job, job_id)
        if job is None:
            return
        author_id = job.author_id
        audio = db.session.get(AudioFile, job.audio_file_id) if job.audio_file_id else None
        if audio is None:
            raise ValueError("audio file for job not found")
        user = db.session.get(User, author_id)
        template_ids = list(job.template_ids or [])
        stored_filename = audio.stored_filename
        original_name = audio.original_filename
        audio_created = audio.created_at
        existing_group = audio.transcript_group_id

        # 1. Decrypt the stored audio, then transcode to 16 kHz mono WAV (the
        #    upload may be mp3/m4a/webm) — exactly what /api/transcribe does via
        #    prepare_wav, so the model gets the format it expects.
        src_fd, src_path = tempfile.mkstemp(suffix=".upload")
        os.close(src_fd)
        wav_fd, audio_path = tempfile.mkstemp(suffix=".wav")
        os.close(wav_fd)
        try:
            with open(src_path, "wb") as f:
                for chunk in audio_storage.open_decrypted_stream(stored_filename):
                    f.write(chunk)
            whisper._transcode_to_wav(src_path, audio_path)

            # 2. Transcribe ONCE (batched, with progress). Transcription is the
            #    expensive shared step; formatting then fans out per template.
            effective_vocab = vocabulary.get_effective_vocabulary(author_id)
            raw_text, words = "", []
            last_pct = 0
            job.stage = "transcribing"
            db.session.commit()
            for kind, payload in whisper.transcribe_path_streaming(
                audio_path,
                initial_prompt=vocabulary.build_whisper_prompt(effective_vocab),
                batched=True,
            ):
                if kind == "progress":
                    pct = int(float(payload) * 70)  # reserve 70-100 for format/save
                    if pct >= last_pct + 10:
                        last_pct = pct
                        job.progress = pct
                        db.session.commit()
                elif kind == "result":
                    raw_text, _segments, words = payload

            # 3. Dictation markers + abbreviations, mirroring /api/transcribe.
            if settings_service.get_dictation_markers_enabled():
                raw_text = dictation_markers.apply_markers(raw_text)
            raw_text = vocabulary.apply_abbreviations(
                raw_text, vocabulary.get_effective_abbreviations(author_id)
            )
        finally:
            for p in (src_path, audio_path):
                try:
                    os.unlink(p)
                except OSError:
                    pass

        # 4. Fan out: one draft note per chosen template (or one raw note when
        #    none chosen). All notes share the audio's transcript_group_id, so
        #    they're siblings of the same recording. Audio decode is already
        #    done, so this loop is just (optional) LLM formatting + save.
        group_id = existing_group or str(uuid.uuid4())
        author_name = f"{user.first_name} {user.last_name}".strip() if user else "Unknown"
        # Resolve the chosen templates (skip any that vanished / aren't simple).
        templates = []
        for tid in template_ids:
            tpl = db.session.get(Template, tid)
            if tpl is not None and not tpl.is_deleted and tpl.template_type == "simple":
                templates.append(tpl)
        targets = templates if templates else [None]  # None => raw-transcript note
        note_ids: list[str] = []
        for i, tpl in enumerate(targets):
            job.stage = f"formatting ({i + 1}/{len(targets)})" if tpl else "saving"
            job.progress = 70 + int((i / len(targets)) * 25)
            db.session.commit()

            markdown = raw_text
            if tpl is not None:
                model_name = tpl.llm_model or settings_service.get_llm_model()
                details = {"note_date": (audio_created or datetime.utcnow()).isoformat(), "participants": []}
                try:
                    markdown = ollama_client.generate_markdown(tpl, raw_text, details, model_name)
                except Exception as e:
                    # Don't lose the transcript over a formatting failure — keep
                    # the raw text as this draft's body.
                    logger.warning("Job %s template %s formatting failed, keeping raw text: %s", job_id, tpl.id, e)
                    markdown = raw_text

            base = job.label or original_name or "Recording"
            # Distinguish siblings by the template that produced each.
            name = f"{base} — {tpl.name}" if tpl is not None and len(targets) > 1 else base
            note = Note(
                note_content_raw=raw_text,
                note_content_markdown=markdown,
                note_content_segments=None,
                note_content_words=words or None,
                note_type="text",
                note_date=audio_created or datetime.utcnow(),
                name=name,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                author_name=author_name,
                template_id=(tpl.id if tpl is not None else None),
                is_deleted=False,
                transcript_group_id=group_id,
                author_id=author_id,
                status="draft",
            )
            db.session.add(note)
            db.session.flush()
            note_ids.append(note.id)

        # Link the audio to this transcript group if it wasn't already.
        if audio.transcript_group_id is None:
            audio.transcript_group_id = group_id
            audio.finalized_at = datetime.utcnow()

        job.note_ids = note_ids
        job.status = Job.STATUS_DONE
        job.stage = "done"
        job.progress = 100
        job.finished_at = datetime.utcnow()
        db.session.commit()
        logger.info("Job %s done -> %d note(s)", job_id, len(note_ids))
