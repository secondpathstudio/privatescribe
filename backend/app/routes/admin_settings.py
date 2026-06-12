"""Admin-only routes for app-wide configurable settings.

PUTs apply immediately to the running process so admins don't have to restart
the backend after changing a limit.
"""
import json
import logging

from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity

from app.extensions import db
from app.security.auth import require_admin
from app.services import audio_retention, diarization, settings as settings_service
from app.services import ollama_client, whisper, whisper_manager
from app.services.audit import log_action

logger = logging.getLogger(__name__)

bp = Blueprint("admin_settings", __name__, url_prefix="/api/admin/settings")


@bp.route('', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def get_settings():
    return jsonify({
        "upload_limit_mb": settings_service.get_upload_limit_mb(),
        "upload_limit_mb_min": settings_service.MIN_UPLOAD_LIMIT_MB,
        "upload_limit_mb_max": settings_service.MAX_UPLOAD_LIMIT_MB,
        # Diarization device:
        # - configured: admin's choice ("auto" or a concrete device)
        # - effective: the concrete device the loaded pipeline is on, or null
        #   if the pipeline hasn't been loaded yet
        # - available: list of concrete devices torch reports usable on this host
        "diarization_device": diarization.configured_device(),
        "diarization_device_effective": diarization.effective_device(),
        "diarization_devices_available": diarization.available_devices(),
        "diarization_device_options": list(diarization.VALID_DEVICES),
        # Trash retention: minimum days an item stays in the trash before it can
        # be permanently deleted, plus whether the purge job auto-deletes past
        # the window.
        "trash_retention_days": settings_service.get_trash_retention_days(),
        "trash_retention_days_min": settings_service.MIN_TRASH_RETENTION_DAYS,
        "trash_retention_days_max": settings_service.MAX_TRASH_RETENTION_DAYS,
        "trash_auto_purge": settings_service.get_trash_auto_purge(),
        # Audio storage: whether /api/transcribe keeps the encrypted recording,
        # and how many days a kept recording survives before `flask purge-audio`
        # deletes it (0 = keep indefinitely).
        "audio_storage_enabled": settings_service.get_audio_storage_enabled(),
        "audio_retention_days": settings_service.get_audio_retention_days(),
        "audio_retention_days_min": settings_service.MIN_AUDIO_RETENTION_DAYS,
        "audio_retention_days_max": settings_service.MAX_AUDIO_RETENTION_DAYS,
        # When true, permanently deleting a note also deletes its encrypted
        # recording once no other note references it (HIPAA disposal). When
        # false, the recording is left for `flask purge-orphaned-audio`.
        "orphaned_audio_purge": settings_service.get_orphaned_audio_purge(),
        # Idle session timeout in minutes (0 = disabled): a logged-in user with
        # no authenticated request for this long is automatically signed out.
        "session_idle_timeout_minutes": settings_service.get_session_idle_timeout_minutes(),
        "session_idle_timeout_minutes_min": settings_service.MIN_SESSION_IDLE_TIMEOUT_MINUTES,
        "session_idle_timeout_minutes_max": settings_service.MAX_SESSION_IDLE_TIMEOUT_MINUTES,
        # When true, the Electron shell forgets credentials on app close.
        "logout_on_close": settings_service.get_logout_on_close(),
        # When true, every user must pass a TOTP challenge after password auth.
        # Users who haven't enrolled are forced through enrollment mid-login.
        "two_factor_required": settings_service.get_two_factor_required(),
        # When true, users can download notes as PDF / DOCX. Flipping off makes
        # the export endpoints return 503 and hides the buttons in the UI.
        "exports_enabled": settings_service.get_exports_enabled(),
        # When true, the transcribe pipeline honors spoken dictation commands
        # ("new paragraph", "new section", "new line") by rewriting them as
        # formatting before the LLM pass. Off = literal phrase is preserved.
        "dictation_markers_enabled": settings_service.get_dictation_markers_enabled(),
        # Admin-wide vocabulary list + abbreviation map. Each user's
        # effective values at transcribe time merge these with their own
        # overlays (see services/vocabulary.py).
        "vocabulary_terms": settings_service.get_admin_vocabulary_terms(),
        "abbreviations": settings_service.get_admin_abbreviations(),
        # Password-strength policy enforced on every credential-creation path.
        # "standard" = length floor only; "strict" = longer floor + common-
        # password blocklist + character-class rules.
        "password_policy": settings_service.get_password_policy(),
        "password_policy_options": list(settings_service.VALID_PASSWORD_POLICIES),
        # Audit-log retention: how many days an audit row is kept before
        # `flask purge-audit-log` archives it to a JSON file and deletes it
        # (0 = keep the full trail forever). audit_auto_purge gates whether
        # the scheduled job actually runs. audit_archive_watermark is read-only
        # status — the last archival point, or null if nothing's been purged.
        "audit_retention_days": settings_service.get_audit_retention_days(),
        "audit_retention_days_min": settings_service.MIN_AUDIT_RETENTION_DAYS,
        "audit_retention_days_max": settings_service.MAX_AUDIT_RETENTION_DAYS,
        "audit_auto_purge": settings_service.get_audit_auto_purge(),
        "audit_archive_watermark": settings_service.get_audit_archive_watermark(),
        # Account lockout: consecutive failed password attempts before an
        # account is temporarily locked, and how long the lock lasts. A
        # threshold of 0 disables lockout entirely.
        "account_lockout_threshold": settings_service.get_account_lockout_threshold(),
        "account_lockout_threshold_min": settings_service.MIN_ACCOUNT_LOCKOUT_THRESHOLD,
        "account_lockout_threshold_max": settings_service.MAX_ACCOUNT_LOCKOUT_THRESHOLD,
        "account_lockout_minutes": settings_service.get_account_lockout_minutes(),
        "account_lockout_minutes_min": settings_service.MIN_ACCOUNT_LOCKOUT_MINUTES,
        "account_lockout_minutes_max": settings_service.MAX_ACCOUNT_LOCKOUT_MINUTES,
    })


@bp.route('/upload-limit-mb', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_upload_limit():
    data = request.get_json(silent=True) or {}
    raw = data.get('value')
    try:
        value = int(raw)
    except (ValueError, TypeError):
        return jsonify({"error": "value must be an integer (MB)"}), 400

    if value < settings_service.MIN_UPLOAD_LIMIT_MB or value > settings_service.MAX_UPLOAD_LIMIT_MB:
        return jsonify({
            "error": (
                f"value must be between {settings_service.MIN_UPLOAD_LIMIT_MB} and "
                f"{settings_service.MAX_UPLOAD_LIMIT_MB} MB"
            ),
        }), 400

    current_user = get_jwt_identity()
    previous = settings_service.get_upload_limit_mb()
    settings_service.set_value(settings_service.UPLOAD_LIMIT_MB, value, updated_by=current_user)

    # Apply immediately — Flask reads MAX_CONTENT_LENGTH per-request, so updating
    # the live config means the next /api/transcribe POST honors the new cap
    # without a restart.
    current_app.config['MAX_CONTENT_LENGTH'] = value * 1024 * 1024

    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.UPLOAD_LIMIT_MB,
        extra={'old': previous, 'new': value},
    )
    db.session.commit()

    return jsonify({"upload_limit_mb": value})


@bp.route('/trash-retention', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_trash_retention():
    """Set the trash-retention window and the auto-purge toggle.

    Body: {"retentionDays": int, "autoPurge": bool}. Both fields optional —
    only the ones present are updated. retentionDays is the minimum number of
    days a soft-deleted note/template must stay in the trash before it can be
    permanently deleted (manually or by `flask purge-trash`). 0 disables the
    waiting period. autoPurge controls whether the purge job actually deletes;
    when false nothing is auto-deleted.

    Takes effect immediately — the next permanent-delete request reads the
    fresh value (settings are read per-request, not cached in app config).
    """
    data = request.get_json(silent=True) or {}
    current_user = get_jwt_identity()

    updates = []  # (key, old, new) tuples for the audit log

    if 'retentionDays' in data:
        try:
            days = int(data['retentionDays'])
        except (ValueError, TypeError):
            return jsonify({"error": "retentionDays must be an integer (days)"}), 400
        if days < settings_service.MIN_TRASH_RETENTION_DAYS or days > settings_service.MAX_TRASH_RETENTION_DAYS:
            return jsonify({
                "error": (
                    f"retentionDays must be between {settings_service.MIN_TRASH_RETENTION_DAYS} "
                    f"and {settings_service.MAX_TRASH_RETENTION_DAYS}"
                ),
            }), 400
        previous = settings_service.get_trash_retention_days()
        settings_service.set_value(settings_service.TRASH_RETENTION_DAYS, days, updated_by=current_user)
        updates.append((settings_service.TRASH_RETENTION_DAYS, previous, days))

    if 'autoPurge' in data:
        auto = data['autoPurge']
        if not isinstance(auto, bool):
            return jsonify({"error": "autoPurge must be a boolean"}), 400
        previous = settings_service.get_trash_auto_purge()
        settings_service.set_value(settings_service.TRASH_AUTO_PURGE, auto, updated_by=current_user)
        updates.append((settings_service.TRASH_AUTO_PURGE, previous, auto))

    if not updates:
        return jsonify({"error": "nothing to update — supply retentionDays and/or autoPurge"}), 400

    for key, old, new in updates:
        log_action(
            'admin.settings_update',
            user_id=current_user,
            resource_type='setting',
            resource_id=key,
            extra={'old': old, 'new': new},
        )
    db.session.commit()

    return jsonify({
        "trash_retention_days": settings_service.get_trash_retention_days(),
        "trash_auto_purge": settings_service.get_trash_auto_purge(),
    })


@bp.route('/audit-retention', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_audit_retention():
    """Set the audit-log retention window and the auto-purge toggle.

    Body: {"retentionDays": int, "autoPurge": bool}. Both fields optional —
    only the ones present are updated. retentionDays is how many days an audit
    row is kept (counted from its created_at) before `flask purge-audit-log`
    archives it to a JSON file and deletes it; 0 disables purging entirely, so
    the full trail is kept forever. autoPurge controls whether the scheduled
    purge job actually runs — when false nothing is archived/deleted unless the
    job is invoked with --force.

    Nothing is purged by this request; it only updates the policy the purge
    job reads. Takes effect immediately — the next `flask purge-audit-log` run
    reads the fresh values.
    """
    data = request.get_json(silent=True) or {}
    current_user = get_jwt_identity()

    updates = []  # (key, old, new) tuples for the audit log

    if 'retentionDays' in data:
        try:
            days = int(data['retentionDays'])
        except (ValueError, TypeError):
            return jsonify({"error": "retentionDays must be an integer (days)"}), 400
        if (days < settings_service.MIN_AUDIT_RETENTION_DAYS
                or days > settings_service.MAX_AUDIT_RETENTION_DAYS):
            return jsonify({
                "error": (
                    f"retentionDays must be between {settings_service.MIN_AUDIT_RETENTION_DAYS} "
                    f"and {settings_service.MAX_AUDIT_RETENTION_DAYS}"
                ),
            }), 400
        previous = settings_service.get_audit_retention_days()
        settings_service.set_value(
            settings_service.AUDIT_RETENTION_DAYS, days, updated_by=current_user
        )
        updates.append((settings_service.AUDIT_RETENTION_DAYS, previous, days))

    if 'autoPurge' in data:
        auto = data['autoPurge']
        if not isinstance(auto, bool):
            return jsonify({"error": "autoPurge must be a boolean"}), 400
        previous = settings_service.get_audit_auto_purge()
        settings_service.set_value(
            settings_service.AUDIT_AUTO_PURGE, auto, updated_by=current_user
        )
        updates.append((settings_service.AUDIT_AUTO_PURGE, previous, auto))

    if not updates:
        return jsonify({"error": "nothing to update — supply retentionDays and/or autoPurge"}), 400

    for key, old, new in updates:
        log_action(
            'admin.settings_update',
            user_id=current_user,
            resource_type='setting',
            resource_id=key,
            extra={'old': old, 'new': new},
        )
    db.session.commit()

    return jsonify({
        "audit_retention_days": settings_service.get_audit_retention_days(),
        "audit_auto_purge": settings_service.get_audit_auto_purge(),
    })


@bp.route('/audio-storage', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_audio_storage():
    """Set audio-storage behavior, and optionally purge stored audio.

    Body: {"storageEnabled": bool, "retentionDays": int,
           "purgeOnNoteDelete": bool, "purgeExisting": bool}.
    All fields optional — only the ones present take effect.

      storageEnabled    — when false, /api/transcribe stops keeping the
        encrypted recording (transcription still runs; the note is text-only).
      retentionDays     — days a kept recording survives before `flask
        purge-audio` deletes it, counted from upload. 0 = keep indefinitely.
      purgeOnNoteDelete — when true, permanently deleting a note also deletes
        its recording once no other note references it. When false, the
        recording is left for the `flask purge-orphaned-audio` sweep.
      purgeExisting     — when true, immediately deletes every stored audio
        file and its row. Used when an admin turns storage off and chooses to
        wipe prior audio; this is irreversible.

    Takes effect immediately — the next /api/transcribe reads the fresh values.
    """
    data = request.get_json(silent=True) or {}
    current_user = get_jwt_identity()

    updates = []  # (key, old, new) tuples for the audit log

    if 'storageEnabled' in data:
        enabled = data['storageEnabled']
        if not isinstance(enabled, bool):
            return jsonify({"error": "storageEnabled must be a boolean"}), 400
        previous = settings_service.get_audio_storage_enabled()
        settings_service.set_value(
            settings_service.AUDIO_STORAGE_ENABLED, enabled, updated_by=current_user
        )
        updates.append((settings_service.AUDIO_STORAGE_ENABLED, previous, enabled))

    if 'retentionDays' in data:
        try:
            days = int(data['retentionDays'])
        except (ValueError, TypeError):
            return jsonify({"error": "retentionDays must be an integer (days)"}), 400
        if days < settings_service.MIN_AUDIO_RETENTION_DAYS or days > settings_service.MAX_AUDIO_RETENTION_DAYS:
            return jsonify({
                "error": (
                    f"retentionDays must be between {settings_service.MIN_AUDIO_RETENTION_DAYS} "
                    f"and {settings_service.MAX_AUDIO_RETENTION_DAYS}"
                ),
            }), 400
        previous = settings_service.get_audio_retention_days()
        settings_service.set_value(
            settings_service.AUDIO_RETENTION_DAYS, days, updated_by=current_user
        )
        updates.append((settings_service.AUDIO_RETENTION_DAYS, previous, days))

    if 'purgeOnNoteDelete' in data:
        purge_on_delete = data['purgeOnNoteDelete']
        if not isinstance(purge_on_delete, bool):
            return jsonify({"error": "purgeOnNoteDelete must be a boolean"}), 400
        previous = settings_service.get_orphaned_audio_purge()
        settings_service.set_value(
            settings_service.ORPHANED_AUDIO_PURGE, purge_on_delete, updated_by=current_user
        )
        updates.append((settings_service.ORPHANED_AUDIO_PURGE, previous, purge_on_delete))

    purged_count = None
    if data.get('purgeExisting') is True:
        purged_count = audio_retention.purge_all(user_id=current_user)

    if not updates and purged_count is None:
        return jsonify({
            "error": (
                "nothing to update — supply storageEnabled, retentionDays, "
                "purgeOnNoteDelete, and/or purgeExisting"
            ),
        }), 400

    for key, old, new in updates:
        log_action(
            'admin.settings_update',
            user_id=current_user,
            resource_type='setting',
            resource_id=key,
            extra={'old': old, 'new': new},
        )
    db.session.commit()

    return jsonify({
        "audio_storage_enabled": settings_service.get_audio_storage_enabled(),
        "audio_retention_days": settings_service.get_audio_retention_days(),
        "orphaned_audio_purge": settings_service.get_orphaned_audio_purge(),
        "audio_purged_count": purged_count,
    })


@bp.route('/logout-on-close', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_logout_on_close():
    """Toggle whether the Electron shell drops auth on app close.

    Body: {"value": bool}. Web clients ignore this — only the desktop app
    consumes it (via the cached flag on the user object).
    """
    data = request.get_json(silent=True) or {}
    value = data.get('value')
    if not isinstance(value, bool):
        return jsonify({"error": "value must be a boolean"}), 400

    current_user = get_jwt_identity()
    previous = settings_service.get_logout_on_close()
    settings_service.set_value(settings_service.LOGOUT_ON_CLOSE, value, updated_by=current_user)
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.LOGOUT_ON_CLOSE,
        extra={'old': previous, 'new': value},
    )
    db.session.commit()

    return jsonify({"logout_on_close": settings_service.get_logout_on_close()})


@bp.route('/session-idle-timeout', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_session_idle_timeout():
    """Set the idle session timeout in minutes. 0 disables it.

    Body: {"value": int}. Takes effect immediately — the request guard reads
    the fresh value on the next call, and it rides along in the user payload
    so clients pick up the new duration on their next validateToken.
    """
    data = request.get_json(silent=True) or {}
    raw = data.get('value')
    try:
        value = int(raw)
    except (ValueError, TypeError):
        return jsonify({"error": "value must be an integer (minutes)"}), 400

    if (value < settings_service.MIN_SESSION_IDLE_TIMEOUT_MINUTES
            or value > settings_service.MAX_SESSION_IDLE_TIMEOUT_MINUTES):
        return jsonify({
            "error": (
                f"value must be between {settings_service.MIN_SESSION_IDLE_TIMEOUT_MINUTES} "
                f"and {settings_service.MAX_SESSION_IDLE_TIMEOUT_MINUTES} minutes "
                f"({settings_service.MIN_SESSION_IDLE_TIMEOUT_MINUTES} disables it)"
            ),
        }), 400

    current_user = get_jwt_identity()
    previous = settings_service.get_session_idle_timeout_minutes()
    settings_service.set_value(
        settings_service.SESSION_IDLE_TIMEOUT_MINUTES, value, updated_by=current_user
    )
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.SESSION_IDLE_TIMEOUT_MINUTES,
        extra={'old': previous, 'new': value},
    )
    db.session.commit()

    return jsonify({"session_idle_timeout_minutes": value})


@bp.route('/account-lockout', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_account_lockout():
    """Set the account-lockout threshold and lock duration.

    Body: {"threshold": int, "minutes": int}. Both fields optional — only the
    ones present are updated. threshold is the number of consecutive failed
    password attempts before an account locks; 0 disables lockout entirely.
    minutes is how long the lock lasts before the account unlocks itself.

    Takes effect immediately — the next /api/login reads the fresh values
    (settings are read per-request, not cached). Already-accumulated failure
    counts are unaffected; the new threshold applies to the next attempt.
    """
    data = request.get_json(silent=True) or {}
    current_user = get_jwt_identity()

    updates = []  # (key, old, new) tuples for the audit log

    if 'threshold' in data:
        try:
            threshold = int(data['threshold'])
        except (ValueError, TypeError):
            return jsonify({"error": "threshold must be an integer"}), 400
        if (threshold < settings_service.MIN_ACCOUNT_LOCKOUT_THRESHOLD
                or threshold > settings_service.MAX_ACCOUNT_LOCKOUT_THRESHOLD):
            return jsonify({
                "error": (
                    f"threshold must be between {settings_service.MIN_ACCOUNT_LOCKOUT_THRESHOLD} "
                    f"and {settings_service.MAX_ACCOUNT_LOCKOUT_THRESHOLD} "
                    f"({settings_service.MIN_ACCOUNT_LOCKOUT_THRESHOLD} disables lockout)"
                ),
            }), 400
        previous = settings_service.get_account_lockout_threshold()
        settings_service.set_value(
            settings_service.ACCOUNT_LOCKOUT_THRESHOLD, threshold, updated_by=current_user
        )
        updates.append((settings_service.ACCOUNT_LOCKOUT_THRESHOLD, previous, threshold))

    if 'minutes' in data:
        try:
            minutes = int(data['minutes'])
        except (ValueError, TypeError):
            return jsonify({"error": "minutes must be an integer"}), 400
        if (minutes < settings_service.MIN_ACCOUNT_LOCKOUT_MINUTES
                or minutes > settings_service.MAX_ACCOUNT_LOCKOUT_MINUTES):
            return jsonify({
                "error": (
                    f"minutes must be between {settings_service.MIN_ACCOUNT_LOCKOUT_MINUTES} "
                    f"and {settings_service.MAX_ACCOUNT_LOCKOUT_MINUTES}"
                ),
            }), 400
        previous = settings_service.get_account_lockout_minutes()
        settings_service.set_value(
            settings_service.ACCOUNT_LOCKOUT_MINUTES, minutes, updated_by=current_user
        )
        updates.append((settings_service.ACCOUNT_LOCKOUT_MINUTES, previous, minutes))

    if not updates:
        return jsonify({"error": "nothing to update — supply threshold and/or minutes"}), 400

    for key, old, new in updates:
        log_action(
            'admin.settings_update',
            user_id=current_user,
            resource_type='setting',
            resource_id=key,
            extra={'old': old, 'new': new},
        )
    db.session.commit()

    return jsonify({
        "account_lockout_threshold": settings_service.get_account_lockout_threshold(),
        "account_lockout_minutes": settings_service.get_account_lockout_minutes(),
    })


@bp.route('/two-factor-required', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_two_factor_required():
    """Toggle whether 2FA is required for all users.

    Body: {"value": bool}. Flipping ON forces every user through TOTP — those
    not yet enrolled enroll mid-login on their next sign-in. Flipping OFF
    leaves stored secrets in place so flipping back ON doesn't make users
    re-enroll.
    """
    data = request.get_json(silent=True) or {}
    value = data.get('value')
    if not isinstance(value, bool):
        return jsonify({"error": "value must be a boolean"}), 400

    current_user = get_jwt_identity()
    previous = settings_service.get_two_factor_required()
    settings_service.set_value(settings_service.TWO_FACTOR_REQUIRED, value, updated_by=current_user)
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.TWO_FACTOR_REQUIRED,
        extra={'old': previous, 'new': value},
    )
    db.session.commit()

    return jsonify({"two_factor_required": settings_service.get_two_factor_required()})


@bp.route('/password-policy', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_password_policy():
    """Set the password-strength policy for all credential-creation paths.

    Body: {"value": "standard" | "strict"}. Applies immediately — the next
    password create / change / reset reads the fresh value. Existing stored
    passwords are never re-validated, so tightening to "strict" can't lock
    anyone out; it's enforced the next time a password is set.
    """
    data = request.get_json(silent=True) or {}
    value = data.get('value')
    if value not in settings_service.VALID_PASSWORD_POLICIES:
        return jsonify({
            "error": f"value must be one of {list(settings_service.VALID_PASSWORD_POLICIES)}",
        }), 400

    current_user = get_jwt_identity()
    previous = settings_service.get_password_policy()
    settings_service.set_value(
        settings_service.PASSWORD_POLICY, value, updated_by=current_user
    )
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.PASSWORD_POLICY,
        extra={'old': previous, 'new': value},
    )
    db.session.commit()

    return jsonify({"password_policy": settings_service.get_password_policy()})


@bp.route('/exports-enabled', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_exports_enabled():
    """Toggle whether users can download notes as PDF / DOCX.

    Body: {"value": bool}. Takes effect immediately — the next /export
    request reads the fresh value (no caching).
    """
    data = request.get_json(silent=True) or {}
    value = data.get('value')
    if not isinstance(value, bool):
        return jsonify({"error": "value must be a boolean"}), 400

    current_user = get_jwt_identity()
    previous = settings_service.get_exports_enabled()
    settings_service.set_value(settings_service.EXPORTS_ENABLED, value, updated_by=current_user)
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.EXPORTS_ENABLED,
        extra={'old': previous, 'new': value},
    )
    db.session.commit()

    return jsonify({"exports_enabled": settings_service.get_exports_enabled()})


@bp.route('/dictation-markers-enabled', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_dictation_markers_enabled():
    """Toggle whether spoken dictation commands rewrite the transcript.

    Body: {"value": bool}. When true, the transcribe route runs Whisper output
    through services/dictation_markers.py so "new paragraph", "new section",
    and "new line" become real formatting. When false, those phrases stay as
    literal words in the raw transcript. Takes effect on the next transcription.
    """
    data = request.get_json(silent=True) or {}
    value = data.get('value')
    if not isinstance(value, bool):
        return jsonify({"error": "value must be a boolean"}), 400

    current_user = get_jwt_identity()
    previous = settings_service.get_dictation_markers_enabled()
    settings_service.set_value(
        settings_service.DICTATION_MARKERS_ENABLED, value, updated_by=current_user
    )
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.DICTATION_MARKERS_ENABLED,
        extra={'old': previous, 'new': value},
    )
    db.session.commit()

    return jsonify({
        "dictation_markers_enabled": settings_service.get_dictation_markers_enabled(),
    })


@bp.route('/vocabulary', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def get_admin_vocabulary():
    """Mirrors the user-side GET shape ({"terms": [...]}) so the shared
    VocabularyEditor component can point at either scope unmodified."""
    return jsonify({"terms": settings_service.get_admin_vocabulary_terms()})


@bp.route('/vocabulary', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_admin_vocabulary():
    """Body: {"terms": [str, ...]}. Replaces the admin-wide list entirely."""
    from app.services import vocabulary
    data = request.get_json(silent=True) or {}
    terms = data.get('terms')
    if not isinstance(terms, list) or not all(isinstance(t, str) for t in terms):
        return jsonify({"error": "terms must be a list of strings"}), 400
    cleaned = vocabulary.parse_vocabulary_textarea("\n".join(terms))

    current_user = get_jwt_identity()
    previous = settings_service.get_admin_vocabulary_terms()
    settings_service.set_value(settings_service.VOCABULARY_TERMS, cleaned, updated_by=current_user)
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.VOCABULARY_TERMS,
        extra={'old_count': len(previous), 'new_count': len(cleaned)},
    )
    db.session.commit()
    return jsonify({"terms": cleaned})


@bp.route('/abbreviations', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def get_admin_abbreviations():
    """Mirrors the user-side GET shape ({"abbreviations": {...}})."""
    return jsonify({"abbreviations": settings_service.get_admin_abbreviations()})


@bp.route('/abbreviations', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_admin_abbreviations():
    """Body: {"abbreviations": {short: long, ...}}. Replaces entirely."""
    data = request.get_json(silent=True) or {}
    mapping = data.get('abbreviations')
    if not isinstance(mapping, dict):
        return jsonify({"error": "abbreviations must be an object"}), 400
    cleaned: dict[str, str] = {}
    for k, v in mapping.items():
        if not isinstance(k, str) or not isinstance(v, str):
            return jsonify({"error": "abbreviation keys and values must be strings"}), 400
        k = k.strip()
        v = v.strip()
        if k and v:
            cleaned[k] = v

    current_user = get_jwt_identity()
    previous = settings_service.get_admin_abbreviations()
    settings_service.set_value(settings_service.ABBREVIATIONS, cleaned, updated_by=current_user)
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.ABBREVIATIONS,
        extra={'old_count': len(previous), 'new_count': len(cleaned)},
    )
    db.session.commit()
    return jsonify({"abbreviations": cleaned})


@bp.route('/diarization-device', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_diarization_device():
    """Set which torch device pyannote runs on.

    Accepts one of "auto" / "mps" / "cuda" / "cpu". "auto" picks the fastest
    device available on the host at load time. If the pipeline is already
    loaded, this moves it onto the new device with `pipeline.to()` — fast,
    no full reload. Persisted to the system_setting table so it survives
    backend restarts.
    """
    data = request.get_json(silent=True) or {}
    value = data.get('value')
    if not isinstance(value, str) or value not in diarization.VALID_DEVICES:
        return jsonify({
            "error": f"value must be one of {list(diarization.VALID_DEVICES)}",
        }), 400

    # Reject concrete devices that torch doesn't see on this host. "auto" is
    # always allowed; it'll resolve to whatever's available at load time.
    if value != "auto" and value not in diarization.available_devices():
        return jsonify({
            "error": (
                f"device {value!r} is not available on this host. Available: "
                f"{diarization.available_devices()}"
            ),
        }), 400

    current_user = get_jwt_identity()
    previous = diarization.configured_device()
    settings_service.set_value(settings_service.DIARIZATION_DEVICE, value, updated_by=current_user)
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.DIARIZATION_DEVICE,
        extra={'old': previous, 'new': value},
    )
    db.session.commit()

    try:
        effective = diarization.set_configured_device(value)
    except Exception as e:
        # set_configured_device persisted the choice via settings_service above,
        # but the live move failed. Surface so the admin knows the next
        # transcription will retry on the new device from cold load.
        logger.error(f"Failed to apply diarization device {value!r}: {type(e).__name__}: {e}")
        return jsonify({
            "error": f"saved, but could not apply live: {e}",
            "diarization_device": value,
            "diarization_device_effective": diarization.effective_device(),
        }), 500

    return jsonify({
        "diarization_device": value,
        "diarization_device_effective": effective,
    })


@bp.route('/llm-model', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def update_llm_model():
    """Set the active default LLM model — what templates without their own
    pinned model format with.

    Body: {"value": "name:tag"}. The model must already be installed in
    Ollama; the Models admin page only offers installed ones, and rejecting
    here keeps a typo from silently breaking every unpinned template.
    """
    data = request.get_json(silent=True) or {}
    value = (data.get('value') or '').strip() if isinstance(data.get('value'), str) else ''
    if not value:
        return jsonify({"error": "value must be a non-empty string"}), 400
    if len(value) > 200:
        return jsonify({"error": "model name too long"}), 400

    try:
        if not ollama_client.is_model_installed(value):
            return jsonify({"error": f"Model '{value}' is not installed."}), 422
    except Exception as e:
        logger.error(f"Ollama list failure: {type(e).__name__}: {e}")
        return jsonify({
            "error": "Could not reach Ollama. Make sure `ollama serve` is running.",
        }), 503

    current_user = get_jwt_identity()
    previous = settings_service.get_llm_model()
    settings_service.set_value(settings_service.LLM_MODEL, value, updated_by=current_user)
    log_action(
        'admin.settings_update',
        user_id=current_user,
        resource_type='setting',
        resource_id=settings_service.LLM_MODEL,
        extra={'old': previous, 'new': value},
    )
    db.session.commit()

    return jsonify({"llm_model": settings_service.get_llm_model()})


@bp.route('/whisper/models', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def whisper_models():
    """Return the Whisper model catalog for the Transcription settings UI.

      available    — every size the UI can offer
      installed    — subset already cached on disk (offline-ready)
      active       — the size /api/transcribe will use
      loaded       — size currently held in memory, or null if not loaded
      approxSizeMb — rough download size per model, for the pre-flight hint
    """
    return jsonify({
        "available": whisper_manager.AVAILABLE_MODELS,
        "installed": whisper_manager.installed_models(),
        "active": settings_service.get_whisper_model(),
        "loaded": whisper.loaded_model_size(),
        "approxSizeMb": whisper_manager.APPROX_SIZE_MB,
    })


@bp.route('/whisper/install', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def whisper_install():
    """Download a Whisper model, then activate it — streamed as NDJSON.

    Body: {"model": "small"}

    Each response line is one JSON object:
      {"status": "starting", "model": str, "totalBytes": int}
      {"status": "downloading", "completed": int, "total": int}   # repeated
      {"status": "activated", "model": str, "done": true}         # terminal OK
      {"status": "error", "message": str, "done": true}           # terminal err

    The model is only persisted as the active `whisper_model` setting AFTER
    the download fully succeeds — an aborted or failed download leaves the
    previous model untouched, so transcription keeps working. This is the
    offline-first contract: the admin watches it reach "activated" before
    disconnecting.
    """
    data = request.get_json(silent=True) or {}
    model = (data.get('model') or '').strip()
    if model not in whisper_manager.AVAILABLE_MODELS:
        return jsonify({
            "error": f"model must be one of {whisper_manager.AVAILABLE_MODELS}",
        }), 400

    current_user = get_jwt_identity()

    @stream_with_context
    def generate():
        succeeded = False
        try:
            for event in whisper_manager.download_model_stream(model):
                if event.get("status") == "success":
                    succeeded = True
                    break
                if event.get("status") == "error":
                    yield json.dumps({**event, "done": True}) + "\n"
                    return
                yield json.dumps(event) + "\n"
        except Exception as e:
            logger.error(f"Whisper install failure: {type(e).__name__}: {e}")
            yield json.dumps({
                "status": "error",
                "message": f"{type(e).__name__}: {e}",
                "done": True,
            }) + "\n"
            return

        if not succeeded:
            yield json.dumps({
                "status": "error",
                "message": "Download ended without completing.",
                "done": True,
            }) + "\n"
            return

        # Download is on disk — now make it the active model. Persist the
        # setting and drop the cached WhisperModel so the next transcription
        # loads the new size.
        previous = settings_service.get_whisper_model()
        settings_service.set_value(
            settings_service.WHISPER_MODEL, model, updated_by=current_user
        )
        whisper.reload_model()
        log_action(
            'admin.settings_update',
            user_id=current_user,
            resource_type='setting',
            resource_id=settings_service.WHISPER_MODEL,
            extra={'old': previous, 'new': model},
        )
        db.session.commit()

        yield json.dumps({
            "status": "activated",
            "model": model,
            "done": True,
        }) + "\n"

    return Response(generate(), mimetype="application/x-ndjson")
