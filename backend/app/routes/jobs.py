"""Background job queue API (Phase 13).

Upload audio for *async* transcription (vs the synchronous `/api/transcribe`):
each upload stores the audio and enqueues a `Job` the worker drains into a draft
note. Plus list/get/cancel for the queue UI. Author-scoped; the org-guard adds
the tenant wall on top in server mode.
"""
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models import AudioFile, Job, Template
from app.services import audio_storage, job_queue
from app.services import settings as settings_service
from app.services.audit import log_action

bp = Blueprint("jobs", __name__, url_prefix="/api/jobs")


def _serialize(job: Job) -> dict:
    return {
        "id": job.id,
        "type": job.type,
        "status": job.status,
        "progress": job.progress,
        "stage": job.stage,
        "label": job.label,
        "audioFileId": job.audio_file_id,
        "diarize": job.diarize,
        "reviewBeforeFormat": job.review_before_format,
        "templateIds": job.template_ids or [],
        "noteIds": job.note_ids or [],
        "error": job.error_text,
        "createdAt": job.created_at,
        "startedAt": job.started_at,
        "finishedAt": job.finished_at,
        # Liveness for the queue UI. The age and stall verdict are computed
        # here, against the server clock, so a LAN client with a skewed clock
        # can't misreport a healthy job as stuck (or vice versa).
        "heartbeatAt": job.heartbeat_at,
        "secondsSinceHeartbeat": _age(job),
        "stalled": job_queue.is_stalled(job),
        # The worker thread is still inside this job even though it's no longer
        # running (canceled, but not yet at a checkpoint — or hung). While true
        # the jobs queued behind it can't start; an app restart frees it.
        "workerHeld": job.status != Job.STATUS_RUNNING and job_queue.worker_holds(job.id),
    }


def _age(job: Job) -> int | None:
    age = job_queue.heartbeat_age_seconds(job)
    return None if age is None else int(age)


def _serialize_detail(job: Job) -> dict:
    """List fields plus the held transcript — for the review screen."""
    d = _serialize(job)
    d["transcript"] = job.transcript
    d["transcriptSegments"] = job.transcript_segments
    return d


@bp.route('/transcribe', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def upload_and_enqueue():
    """Store an uploaded audio file and queue it for transcription.

    Multipart: `audio` (the file) + zero or more `templateIds` (simple
    templates, owned by the caller). The transcript is produced once and then
    formatted through each template — one draft note per template (or one raw
    note when none are given). One file per request — the batch-upload UI calls
    this once per file. Returns the created Job.
    """
    current_user = get_jwt_identity()

    # The worker reads the stored (encrypted) audio back, so storage must be on.
    if not settings_service.get_audio_storage_enabled():
        return jsonify({"error": "Audio storage must be enabled to queue transcriptions."}), 400

    file = request.files.get('audio') or request.files.get('file')
    if not file or not file.filename:
        return jsonify({"error": "No audio file provided"}), 400

    # Dedupe while preserving order; validate each is the caller's own simple
    # template (structured templates aren't run in the worker yet).
    template_ids = []
    for tid in request.form.getlist('templateIds'):
        tid = (tid or '').strip()
        if not tid or tid in template_ids:
            continue
        tpl = Template.query.filter_by(id=tid, author_id=current_user, is_deleted=False).first()
        if not tpl:
            return jsonify({"error": f"template {tid} not found"}), 400
        if tpl.template_type != 'simple':
            return jsonify({"error": "Only simple templates can format a queued transcription."}), 400
        template_ids.append(tid)

    truthy = ('1', 'true', 'yes', 'on')
    diarize = (request.form.get('diarize') or '').strip().lower() in truthy
    review = (request.form.get('reviewBeforeFormat') or '').strip().lower() in truthy

    file.seek(0)
    stored_filename, size_bytes = audio_storage.save_encrypted(file.stream)
    audio = AudioFile(
        author_id=current_user,
        original_filename=(file.filename or 'recording')[:512],
        stored_filename=stored_filename,
        mime_type=(file.mimetype or None),
        size_bytes=size_bytes,
    )
    db.session.add(audio)
    db.session.flush()

    job = job_queue.enqueue_transcription(
        current_user, audio.id, template_ids=template_ids, diarize=diarize,
        review_before_format=review, label=file.filename,
    )
    db.session.flush()
    log_action(
        'job.enqueue',
        user_id=current_user,
        resource_type='job',
        resource_id=job.id,
        extra={'audio_file_id': audio.id, 'template_ids': template_ids,
               'diarize': diarize, 'review_before_format': review},
    )
    db.session.commit()
    return jsonify(_serialize(job)), 201


@bp.route('', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def list_jobs():
    """The caller's recent jobs, newest first. Optional ?status= filter."""
    current_user = get_jwt_identity()
    q = Job.query.filter_by(author_id=current_user)
    status = request.args.get('status')
    if status:
        q = q.filter_by(status=status)
    jobs = q.order_by(Job.created_at.desc()).limit(200).all()
    return jsonify([_serialize(j) for j in jobs])


@bp.route('/<string:job_id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_job(job_id):
    current_user = get_jwt_identity()
    job = Job.query.filter_by(id=job_id, author_id=current_user).first()
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(_serialize_detail(job))


@bp.route('/<string:job_id>/approve', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def approve_job(job_id):
    """Approve a reviewed transcript and resume formatting. Optional body
    `transcript` replaces the held text (the user's corrections); then the job
    re-queues and the worker fans it out to the chosen templates."""
    current_user = get_jwt_identity()
    job = Job.query.filter_by(id=job_id, author_id=current_user).first()
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.status != Job.STATUS_AWAITING_REVIEW:
        return jsonify({"error": f"Job is {job.status}, not awaiting review."}), 409

    data = request.get_json(silent=True) or {}
    corrected = data.get('transcript')
    if isinstance(corrected, str) and corrected.strip() and corrected != job.transcript:
        # The user edited the text; the old diarized segments may no longer line
        # up, so drop them — the edited transcript is the source of truth.
        job.transcript = corrected
        job.transcript_segments = None
    # Re-queue for the formatting phase (transcript is present, so the worker
    # skips transcription and goes straight to fan-out).
    job.status = Job.STATUS_QUEUED
    job.stage = "queued for formatting"
    job.error_text = None
    db.session.commit()
    job_queue.wake()
    log_action(
        'job.approve',
        user_id=current_user,
        resource_type='job',
        resource_id=job.id,
    )
    return jsonify(_serialize(job))


@bp.route('/<string:job_id>/cancel', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def cancel_job(job_id):
    """Cancel a queued, running, or awaiting-review job.

    Canceling a running job is cooperative: the row flips to canceled now (so
    the UI frees up immediately) and the worker stops at its next checkpoint —
    a progress save, a stage change, or the final commit — discarding its
    temp files and any not-yet-saved draft notes. A thread hung inside native
    code never reaches a checkpoint; `workerHeld` in the response reports that,
    and an app restart clears it. A done/failed job is a no-op error.
    """
    from sqlalchemy import update

    current_user = get_jwt_identity()
    job = Job.query.filter_by(id=job_id, author_id=current_user).first()
    if not job:
        return jsonify({"error": "Job not found"}), 404
    cancelable = (Job.STATUS_QUEUED, Job.STATUS_RUNNING, Job.STATUS_AWAITING_REVIEW)
    was = job.status
    # Compare-and-set, so a cancel racing the worker's own finish can't flip a
    # job that just completed (the worker CASes running -> done the same way).
    res = db.session.execute(
        update(Job)
        .where(Job.id == job.id, Job.status.in_(cancelable))
        .values(status=Job.STATUS_CANCELED, stage="canceled",
                finished_at=datetime.utcnow())
    )
    if res.rowcount != 1:
        db.session.rollback()
        db.session.refresh(job)
        return jsonify({"error": f"Can't cancel a job that is {job.status}."}), 409
    db.session.commit()
    db.session.refresh(job)
    log_action('job.cancel', user_id=current_user, resource_type='job',
               resource_id=job.id, extra={'from_status': was})
    return jsonify(_serialize(job))


@bp.route('/<string:job_id>/retry', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def retry_job(job_id):
    """Re-queue a failed or canceled job from its stored recording — no
    re-upload. A held (reviewed) transcript is kept, so a job that failed
    during formatting resumes at formatting rather than re-transcribing."""
    current_user = get_jwt_identity()
    job = Job.query.filter_by(id=job_id, author_id=current_user).first()
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.status not in (Job.STATUS_FAILED, Job.STATUS_CANCELED):
        return jsonify({"error": f"Only failed or canceled jobs can be retried (this one is {job.status})."}), 409
    if job_queue.worker_holds(job.id):
        # Requeuing now would let the stuck thread and a fresh claim both
        # work the same job. Only a restart (which recovers it) is safe.
        return jsonify({
            "error": "This job is still held by the transcription worker. "
                     "Restart the app, then retry.",
        }), 409
    audio = db.session.get(AudioFile, job.audio_file_id) if job.audio_file_id else None
    if audio is None or not audio_storage.file_exists(audio.stored_filename):
        return jsonify({"error": "The recording for this job is no longer stored, so it can't be retried. Upload it again."}), 409

    was = job.status
    job.status = Job.STATUS_QUEUED
    job.stage = "queued (retry)"
    job.progress = 0
    job.error_text = None
    job.attempts = 0  # user-initiated: a fresh interruption budget
    job.started_at = None
    job.finished_at = None
    job.heartbeat_at = None
    db.session.commit()
    job_queue.wake()
    log_action('job.retry', user_id=current_user, resource_type='job',
               resource_id=job.id, extra={'from_status': was})
    return jsonify(_serialize(job))
