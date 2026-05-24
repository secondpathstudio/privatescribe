"""Server status for the admin dashboard (roadmap Phase 9 item 5).

Super-admin (central IT) view of the running server: deployment mode, the
transcription model, an approximate connected-client count, install-wide
user/org totals, and backup freshness. Service-level health of the Caddy /
Ollama / backend *daemons* is observed launchd-side by the Electron control
panel; this endpoint covers what the app itself knows.
"""
from datetime import datetime, timedelta

from flask import Blueprint, jsonify
from flask_cors import cross_origin

from app.models import Organization, Session, User
from app.security.auth import require_super_admin
from app.services import settings as settings_service
from app.services import whisper
from app.services.net import lan_ip as _lan_ip

bp = Blueprint("admin_server", __name__, url_prefix="/api/admin/server")


def _active_session_count() -> int:
    """Non-revoked sessions touched within the idle-timeout window — an
    approximation of currently-connected clients. A 0 idle timeout (disabled)
    falls back to counting all non-revoked sessions."""
    q = Session.query.filter_by(revoked=False)
    idle_minutes = settings_service.get_session_idle_timeout_minutes()
    if idle_minutes > 0:
        cutoff = datetime.utcnow() - timedelta(minutes=idle_minutes)
        q = q.filter(Session.last_active_at >= cutoff)
    return q.count()


@bp.route("/status", methods=["GET"])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_super_admin
def server_status():
    return jsonify({
        "mode": "server",
        "whisperModel": settings_service.get_whisper_model(),
        "whisperLoaded": whisper.loaded_model_size(),
        "activeSessions": _active_session_count(),
        "users": User.query.count(),
        "organizations": Organization.query.count(),
        "lastBackupAt": settings_service.get_last_backup_at(),
        # LAN IP for the client pairing URL/QR (the dashboard pairs it with the
        # port it was served on). None if only loopback is available.
        "lanIp": _lan_ip(),
    })
