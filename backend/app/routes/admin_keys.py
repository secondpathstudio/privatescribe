"""SQLCipher key management: export, rotate, and audit-log dismissal."""
import secrets
from datetime import datetime
from pathlib import Path

import sqlcipher3
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity
from werkzeug.security import check_password_hash

from app.extensions import db, limiter
from app.models import KeyExportDismissal, KeyExportLog, User
from app.security import sqlcipher as sqlcipher_state
from app.security.auth import require_admin
from app.security.secrets import (mark_backup_key_acknowledged,
                                  persist_sqlcipher_key,
                                  reset_backup_key_acknowledgement)

bp = Blueprint("admin_keys", __name__)


@bp.route('/api/acknowledge-backup-key', methods=['POST'])
@require_admin
def acknowledge_backup_key():
    mark_backup_key_acknowledged()
    return jsonify({"acknowledged": True}), 200


@bp.route('/api/admin/backup-key', methods=['POST'])
@require_admin
@limiter.limit("3 per hour")
def export_backup_key():
    data = request.get_json() or {}
    password = data.get('password')
    if not password:
        return jsonify({"error": "Password required"}), 400
    user = User.query.get(get_jwt_identity())
    if not user or not check_password_hash(user.password, password):
        return jsonify({"error": "Invalid password"}), 401
    log = KeyExportLog(
        admin_id=user.id,
        admin_email=user.email,
        ip=request.remote_addr,
    )
    db.session.add(log)
    db.session.commit()
    return jsonify({"backup_key": sqlcipher_state.current_key()}), 200


@bp.route('/api/admin/rotate-backup-key', methods=['POST'])
@require_admin
@limiter.limit("3 per hour")
def rotate_backup_key():
    data = request.get_json() or {}
    password = data.get('password')
    if not password:
        return jsonify({"error": "Password required"}), 400
    user = User.query.get(get_jwt_identity())
    if not user or not check_password_hash(user.password, password):
        return jsonify({"error": "Invalid password"}), 401

    new_key = secrets.token_hex(32)
    db_path = Path(current_app.instance_path) / "privatescribe.db"
    old_key = sqlcipher_state.current_key()

    # Step 1: rekey the file on disk via a fresh raw connection so we don't
    # fight SQLAlchemy's pool. PRAGMA rekey is atomic at the SQLCipher layer
    # — if it fails, nothing on disk has changed and we bail without touching
    # in-memory state.
    rekey_conn = sqlcipher3.connect(str(db_path), check_same_thread=False)
    try:
        rekey_conn.execute(f"PRAGMA key = \"x'{old_key}'\"")
        rekey_conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone()
        rekey_conn.execute(f"PRAGMA rekey = \"x'{new_key}'\"")
        rekey_conn.commit()
    finally:
        rekey_conn.close()

    # Step 2: write the audit log entry via the existing session BEFORE we
    # dispose the pool. The current connection was opened with the old key
    # but SQLCipher keeps already-open connections working across a rekey.
    log = KeyExportLog(
        admin_id=user.id,
        admin_email=user.email,
        ip=request.remote_addr,
    )
    db.session.add(log)
    db.session.commit()

    # Step 3: housekeeping. Disk is already on the new key; if any of this
    # fails, the running process keeps working but a restart would boot with
    # the old key in .env and fail to open the DB. Log the new key loudly so
    # the operator can recover by hand-patching .env.
    try:
        sqlcipher_state.update_key(new_key)
        persist_sqlcipher_key(new_key)
        reset_backup_key_acknowledgement()
        # Drop pooled connections so subsequent requests open with the new key.
        db.engine.dispose()
    except Exception as e:
        current_app.logger.error(
            f"CRITICAL: SQLCipher rekey succeeded on disk but housekeeping failed. "
            f"NEW KEY (save and patch backend/.env, then restart): {new_key}. Error: {e}"
        )
        raise

    return jsonify({"backup_key": new_key, "rotated": True}), 200


@bp.route('/api/admin/key-exports/unseen', methods=['GET'])
@require_admin
def unseen_key_exports():
    user_id = get_jwt_identity()
    dismissal = KeyExportDismissal.query.get(user_id)
    cutoff = dismissal.dismissed_at if dismissal else datetime(1970, 1, 1)
    logs = (KeyExportLog.query
            .filter(KeyExportLog.exported_at > cutoff)
            .order_by(KeyExportLog.exported_at.desc())
            .all())
    return jsonify({
        "exports": [
            {
                "adminEmail": log.admin_email,
                "isSelf": log.admin_id == user_id,
                "exportedAt": log.exported_at,
                "ip": log.ip,
            } for log in logs
        ],
    }), 200


@bp.route('/api/admin/key-exports/dismiss', methods=['POST'])
@require_admin
def dismiss_key_exports():
    user_id = get_jwt_identity()
    dismissal = KeyExportDismissal.query.get(user_id)
    now = datetime.utcnow()
    if dismissal:
        dismissal.dismissed_at = now
    else:
        db.session.add(KeyExportDismissal(user_id=user_id, dismissed_at=now))
    db.session.commit()
    return jsonify({"dismissed": True}), 200
