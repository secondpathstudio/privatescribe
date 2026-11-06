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

# Liveness. Progress is written to the DB at most this often (each write also
# bumps heartbeat_at), so a long file updates the queue UI steadily without a
# commit per Whisper segment.
HEARTBEAT_SAVE_SEC = 5.0
# A running job with no heartbeat for this long is reported as `stalled`.
# Generous next to HEARTBEAT_SAVE_SEC: real work on the slowest CPU still
# produces a segment / diarization batch well inside it.
STALL_AFTER_SEC = 5 * 60
# LLM formatting is one blocking Ollama call per template with no progress
# callback, so the heartbeat can't advance during it; allow it much longer
# before calling it stalled (a big transcript on a CPU-only box is slow).
FORMAT_STALL_AFTER_SEC = 30 * 60

# Progress bands (0-100) for the stages of a queued transcription.
PROGRESS_TRANSCRIBE_END = 55
PROGRESS_DIARIZE_END = 70

_started = False
_start_lock = threading.Lock()
_wake = threading.Event()


def wake():
    """Nudge the worker to look for work now (e.g. after an approval)."""
    _wake.set()


def heartbeat_age_seconds(job, now: datetime | None = None) -> float | None:
    """Seconds since the job last made progress, or None if not running.

    Computed server-side so a LAN client's clock skew can't fake a stall.
    Falls back to started_at for a row that predates the heartbeat column.
    """
    from app.models import Job

    if job.status != Job.STATUS_RUNNING:
        return None
    last = job.heartbeat_at or job.started_at
    if last is None:
        return None
    return max(0.0, ((now or datetime.utcnow()) - last).total_seconds())


def is_stalled(job, now: datetime | None = None) -> bool:
    """True when a running job hasn't made progress for longer than its
    stage's threshold — slow-but-working never trips it, a hung thread does."""
    age = heartbeat_age_seconds(job, now)
    if age is None:
        return False
    limit = FORMAT_STALL_AFTER_SEC if (job.stage or "").startswith("formatting") else STALL_AFTER_SEC
    return age > limit


class _ProgressWriter:
    """Throttled progress + heartbeat writes for the running job.

    Every call updates the in-memory row; the DB commit (which is what the
    queue UI polls) happens at most every HEARTBEAT_SAVE_SEC, or immediately
    with ``force=True`` (stage transitions). Only real work calls this — there
    is deliberately no ticker thread, which would keep a hung job looking alive.
    """

    def __init__(self, job, interval: float = HEARTBEAT_SAVE_SEC):
        self.job = job
        self.interval = interval
        self._last_save: float | None = None  # first update always saves

    def update(self, progress: float | None = None, stage: str | None = None,
               *, force: bool = False) -> None:
        from app.extensions import db

        if progress is not None:
            self.job.progress = max(0, min(100, int(progress)))
        if stage is not None:
            self.job.stage = stage[:64]
        now = time.monotonic()
        if force or self._last_save is None or now - self._last_save >= self.interval:
            self.job.heartbeat_at = datetime.utcnow()
            db.session.commit()
            self._last_save = now


def enqueue_transcription(author_id, audio_file_id, *, template_ids=None, diarize=False,
                          review_before_format=False, label=None):
    """Create a queued transcription job and wake the worker. Returns the Job.

    `template_ids` is the (possibly empty) list of simple templates to format
    the single transcript through — one draft note per template, or one raw
    note when empty. `diarize` labels speakers once before formatting. Caller
    commits (so AudioFile + Job land together).
    """
    from app.extensions import db
    from app.models import Job

    job = Job(
        author_id=author_id,
        type="transcription",
        status=Job.STATUS_QUEUED,
        audio_file_id=audio_file_id,
        diarize=bool(diarize),
        review_before_format=bool(review_before_format),
        template_ids=list(template_ids) if template_ids else None,
        label=(label or None),
        progress=0,
    )
    db.session.add(job)
    # The worker polls anyway; this just shortens the latency to pickup.
    _wake.set()
    return job


# A job interrupted this many times (backend crash, app quit, update restart,
# machine shutdown mid-transcription) is failed instead of requeued, so a file
# that reliably takes the backend down can't crash-loop the worker on every boot.
MAX_ATTEMPTS = 3


def recover_interrupted_jobs(app) -> tuple[int, int]:
    """Requeue (or fail) jobs left in `running` by a previous process.

    There is exactly one worker and it lives in this process, so at boot any
    row still marked running belongs to a worker that no longer exists. Without
    this sweep such a job sits at its last progress forever: the worker only
    claims `queued` rows and `running` can't be canceled — which is how a long
    upload looks like it "stopped halfway" after the app restarted mid-job.

    Returns ``(requeued, failed)``. Must run before the worker thread starts.
    """
    from app.extensions import db
    from app.models import Job

    requeued = failed = 0
    with app.app_context():
        try:
            stuck = Job.query.filter_by(status=Job.STATUS_RUNNING).all()
            for job in stuck:
                if (job.attempts or 0) >= MAX_ATTEMPTS:
                    job.status = Job.STATUS_FAILED
                    job.error_text = (
                        f"Transcription was interrupted {job.attempts} times "
                        "(the app closed or the backend stopped mid-job). "
                        "Re-upload the file to try again."
                    )
                    job.finished_at = datetime.utcnow()
                    failed += 1
                else:
                    job.status = Job.STATUS_QUEUED
                    job.stage = "queued (resuming after interruption)"
                    job.progress = 0
                    job.started_at = None
                    job.heartbeat_at = None
                    requeued += 1
            if stuck:
                db.session.commit()
                logger.warning(
                    "Recovered %d interrupted job(s): %d requeued, %d failed.",
                    len(stuck), requeued, failed,
                )
        except Exception:
            # Never block boot on recovery (e.g. job table not migrated yet).
            db.session.rollback()
            logger.exception("Interrupted-job recovery failed")
    return requeued, failed


def start_worker(app):
    """Start the single worker thread (idempotent). Call once from create_app."""
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
    recover_interrupted_jobs(app)
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
        job.heartbeat_at = job.started_at
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
    from app.services import audio_storage, diarization, dictation_markers, ollama_client
    from app.services import settings as settings_service
    from app.services import stt, vocabulary, whisper

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

        # If the transcript is already held, the job was reviewed + approved —
        # skip straight to formatting. Otherwise transcribe (+ diarize) now.
        if job.transcript is not None:
            raw_text = job.transcript
            segments = job.transcript_segments
            words = job.transcript_words or []
        else:
            # 1. Decrypt the stored audio, then transcode to 16 kHz mono WAV (the
            #    upload may be mp3/m4a/webm) — exactly what /api/transcribe does
            #    via prepare_wav, so the model gets the format it expects.
            job.stage = "decoding"
            job.heartbeat_at = datetime.utcnow()
            db.session.commit()
            src_fd, src_path = tempfile.mkstemp(suffix=".upload")
            os.close(src_fd)
            wav_fd, audio_path = tempfile.mkstemp(suffix=".wav")
            os.close(wav_fd)
            try:
                with open(src_path, "wb") as f:
                    for chunk in audio_storage.open_decrypted_stream(stored_filename):
                        f.write(chunk)
                whisper._transcode_to_wav(src_path, audio_path)

                # 2. Transcribe ONCE (batched, with progress). Transcription is
                #    the expensive shared step; formatting fans out per template.
                effective_vocab = vocabulary.get_effective_vocabulary(author_id)
                raw_text, words, whisper_segments = "", [], []
                writer = _ProgressWriter(job)
                writer.update(0, "transcribing", force=True)
                for kind, payload in stt.get_engine().transcribe_streaming(
                    audio_path,
                    initial_prompt=vocabulary.build_whisper_prompt(effective_vocab),
                    batched=True,
                ):
                    if kind == "progress":
                        # Bands: transcribe 0-55, diarize 55-70, format/save 70-100.
                        writer.update(float(payload) * PROGRESS_TRANSCRIBE_END)
                    elif kind == "result":
                        raw_text, whisper_segments, words = payload

                # 3. Dictation markers + abbreviations, mirroring /api/transcribe.
                if settings_service.get_dictation_markers_enabled():
                    raw_text = dictation_markers.apply_markers(raw_text)
                raw_text = vocabulary.apply_abbreviations(
                    raw_text, vocabulary.get_effective_abbreviations(author_id)
                )

                # 3b. Diarize ONCE if requested + available, then share the
                #     labeled transcript across every fanned-out note. Needs the
                #     WAV, so it runs before the temp files are cleaned up.
                #     Best-effort: on failure we keep the non-diarized transcript.
                segments = None
                if job.diarize and diarization.is_available():
                    writer.update(PROGRESS_TRANSCRIBE_END, "labeling speakers", force=True)
                    span = PROGRESS_DIARIZE_END - PROGRESS_TRANSCRIBE_END

                    def _on_diarize(frac, label):
                        writer.update(PROGRESS_TRANSCRIBE_END + frac * span,
                                      f"labeling speakers ({label})")

                    try:
                        turns = diarization.diarize_path(audio_path, progress=_on_diarize)
                        merged = diarization.merge_segments(whisper_segments, turns)
                        if merged:
                            segments = merged
                            raw_text = diarization.segments_to_text(merged)
                    except Exception as e:
                        logger.warning("Job %s diarization failed, keeping flat transcript: %s", job_id, e)
            finally:
                for p in (src_path, audio_path):
                    try:
                        os.unlink(p)
                    except OSError:
                        pass

            # 3c. Hold for review before any formatting, if asked. The user
            #     fixes the transcript once; approving re-queues the job (now
            #     with a held transcript), which resumes at the fan-out below.
            if job.review_before_format:
                job.transcript = raw_text
                job.transcript_segments = segments
                job.transcript_words = words or None
                job.status = Job.STATUS_AWAITING_REVIEW
                job.stage = "awaiting review"
                job.progress = PROGRESS_DIARIZE_END
                db.session.commit()
                logger.info("Job %s held for review", job_id)
                return

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
            job.progress = PROGRESS_DIARIZE_END + int((i / len(targets)) * 25)
            # Stage transition = progress: bump the heartbeat so the long,
            # callback-less Ollama call below starts with a fresh clock.
            job.heartbeat_at = datetime.utcnow()
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
                note_content_segments=segments,
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
