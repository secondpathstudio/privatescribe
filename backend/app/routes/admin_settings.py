"""Admin-only routes for app-wide configurable settings.

PUTs apply immediately to the running process so admins don't have to restart
the backend after changing a limit.
"""
from flask import Blueprint, current_app, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity

from app.extensions import db
from app.security.auth import require_admin
from app.services import diarization, settings as settings_service
from app.services.audit import log_action

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
        print(f"Failed to apply diarization device {value!r}: {type(e).__name__}: {e}")
        return jsonify({
            "error": f"saved, but could not apply live: {e}",
            "diarization_device": value,
            "diarization_device_effective": diarization.effective_device(),
        }), 500

    return jsonify({
        "diarization_device": value,
        "diarization_device_effective": effective,
    })
