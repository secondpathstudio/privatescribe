"""Per-user transcription settings: vocabulary + abbreviations.

These endpoints let an authenticated user manage their own overlays on top
of the admin-wide defaults. Effective values used at transcribe time are
the merge of the admin row and the user row (see services/vocabulary.py).
The GET response includes the admin defaults read-only so the user can see
what they're adding to.
"""
import base64
import hashlib

from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models import User
from app.services import audio_storage
from app.services import vocabulary
from app.services import settings as settings_service
from app.services.audit import log_action

bp = Blueprint("user_settings", __name__, url_prefix="/api/user")


def _current_user_or_404():
    user = User.query.get(get_jwt_identity())
    if not user:
        return None, (jsonify({"error": "User not found"}), 404)
    return user, None


@bp.route('/vocabulary', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_vocabulary():
    user, err = _current_user_or_404()
    if err:
        return err
    return jsonify({
        "terms": vocabulary._user_vocabulary(user),
        "admin_terms": settings_service.get_admin_vocabulary_terms(),
    })


@bp.route('/vocabulary', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_vocabulary():
    """Body: {"terms": [str, ...]}. Replaces the user's list entirely."""
    user, err = _current_user_or_404()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    terms = data.get('terms')
    if not isinstance(terms, list) or not all(isinstance(t, str) for t in terms):
        return jsonify({"error": "terms must be a list of strings"}), 400

    # Reuse the textarea parser's dedup + trim logic so the GET round-trip
    # mirrors the saved canonical form.
    cleaned = vocabulary.parse_vocabulary_textarea("\n".join(terms))
    user.vocabulary_terms = vocabulary.serialize_vocabulary(cleaned)
    log_action(
        'user.vocabulary_update',
        user_id=user.id,
        resource_type='user',
        resource_id=user.id,
        extra={'count': len(cleaned)},
    )
    db.session.commit()
    return jsonify({"terms": cleaned})


@bp.route('/abbreviations', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_abbreviations():
    user, err = _current_user_or_404()
    if err:
        return err
    return jsonify({
        "abbreviations": vocabulary._user_abbreviations(user),
        "admin_abbreviations": settings_service.get_admin_abbreviations(),
    })


@bp.route('/abbreviations', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_abbreviations():
    """Body: {"abbreviations": {short: long, ...}}. Replaces the user's
    map entirely. Values that are empty or non-string are rejected outright
    so silent data loss can't happen on a malformed save."""
    user, err = _current_user_or_404()
    if err:
        return err
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
    user.abbreviations = vocabulary.serialize_abbreviations(cleaned)
    log_action(
        'user.abbreviations_update',
        user_id=user.id,
        resource_type='user',
        resource_id=user.id,
        extra={'count': len(cleaned)},
    )
    db.session.commit()
    return jsonify({"abbreviations": cleaned})


@bp.route('/recording-key', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_recording_key():
    """Per-user key for the client-side encrypted recording buffer.

    The frontend persists in-progress recording chunks to IndexedDB for crash
    durability, AES-GCM-encrypted with this key so patient audio never touches
    disk in plaintext. The key is derived (HKDF) from the SQLCipher master and
    scoped to the requesting user — it protects only that user's own buffered
    audio and grants nothing beyond what their session already reads via audio
    playback. The fingerprint lets the client detect a master-key rotation:
    chunks buffered under the old key are then unrecoverable, and the client
    surfaces that instead of failing on garbage decrypts.
    """
    user, err = _current_user_or_404()
    if err:
        return err
    key = audio_storage.derive_recording_chunk_key(user.id)
    fingerprint = hashlib.sha256(key).hexdigest()[:16]
    # Audited per issuance (once per recording start / recovery attempt, not
    # per chunk) so key material handout leaves a trail like the backup-key
    # export does.
    log_action(
        'security.recording_key_issued',
        user_id=user.id,
        resource_type='user',
        resource_id=user.id,
    )
    db.session.commit()
    return jsonify({
        "key": base64.b64encode(key).decode("ascii"),
        "fingerprint": fingerprint,
    })
