"""Admin-only routes for app-wide configurable settings.

PUTs apply immediately to the running process so admins don't have to restart
the backend after changing a limit.
"""
from flask import Blueprint, current_app, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity

from app.security.auth import require_admin
from app.services import settings as settings_service

bp = Blueprint("admin_settings", __name__, url_prefix="/api/admin/settings")


@bp.route('', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def get_settings():
    return jsonify({
        "upload_limit_mb": settings_service.get_upload_limit_mb(),
        "upload_limit_mb_min": settings_service.MIN_UPLOAD_LIMIT_MB,
        "upload_limit_mb_max": settings_service.MAX_UPLOAD_LIMIT_MB,
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
    settings_service.set_value(settings_service.UPLOAD_LIMIT_MB, value, updated_by=current_user)

    # Apply immediately — Flask reads MAX_CONTENT_LENGTH per-request, so updating
    # the live config means the next /api/transcribe POST honors the new cap
    # without a restart.
    current_app.config['MAX_CONTENT_LENGTH'] = value * 1024 * 1024

    return jsonify({"upload_limit_mb": value})
