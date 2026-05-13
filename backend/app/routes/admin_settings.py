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
