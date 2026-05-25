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
        "templateIds": job.template_ids or [],
        "noteIds": job.note_ids or [],
        "error": job.error_text,
        "createdAt": job.created_at,
        "startedAt": job.started_at,
        "finishedAt": job.finished_at,
    }


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
        current_user, audio.id, template_ids=template_ids, label=file.filename
    )
    db.session.flush()
    log_action(
        'job.enqueue',
        user_id=current_user,
        resource_type='job',
        resource_id=job.id,
        extra={'audio_file_id': audio.id, 'template_ids': template_ids},
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
    return jsonify(_serialize(job))


@bp.route('/<string:job_id>/cancel', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def cancel_job(job_id):
    """Cancel a still-queued job. A running job can't be interrupted mid-decode;
    a done/failed one is a no-op error."""
    current_user = get_jwt_identity()
    job = Job.query.filter_by(id=job_id, author_id=current_user).first()
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.status != Job.STATUS_QUEUED:
        return jsonify({"error": f"Can't cancel a job that is {job.status}."}), 409
    job.status = Job.STATUS_CANCELED
    job.finished_at = datetime.utcnow()
    db.session.commit()
    return jsonify(_serialize(job))
