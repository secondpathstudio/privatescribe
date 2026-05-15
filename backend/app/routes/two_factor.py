"""User-facing 2FA enrollment / management routes.

The login challenge (`/api/login/2fa`) lives in `app/routes/auth.py` because
it shares the partial-token issuing logic with `/api/login`. Everything
self-service for an already-authenticated user (enroll, verify, disable,
regenerate recovery codes, status) lives here.
"""
from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required
from werkzeug.security import check_password_hash

from app.extensions import db, limiter
from app.models import User
from app.services import two_factor
from app.services import settings as settings_service
from app.services.audit import log_action

bp = Blueprint("two_factor", __name__, url_prefix="/api/2fa")


@bp.route('/status', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def status():
    user = User.query.get(get_jwt_identity())
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({
        "enrolled": two_factor.is_enrolled(user),
        "required": settings_service.get_two_factor_required(),
        "recovery_codes_remaining": two_factor.remaining_recovery_codes(user),
    })


@bp.route('/enroll', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
@limiter.limit("10 per minute")
def enroll():
    """Begin enrollment — generate a fresh secret + QR. User completes
    enrollment by POSTing a valid code to /api/2fa/verify. Refuses if the
    user is already enrolled (they must disable first)."""
    user = User.query.get(get_jwt_identity())
    if not user:
        return jsonify({"error": "User not found"}), 404
    if two_factor.is_enrolled(user):
        return jsonify({"error": "Already enrolled. Disable 2FA before re-enrolling."}), 400

    try:
        secret, uri, qr = two_factor.start_enrollment(user)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    log_action('user.2fa_enroll_start', user_id=user.id, user_email=user.email)
    db.session.commit()
    return jsonify({
        "secret": secret,
        "provisioning_uri": uri,
        "qr_data_url": qr,
    })


@bp.route('/verify', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
@limiter.limit("10 per minute")
def verify():
    """Confirm the first code from the authenticator app, mark the user
    enrolled, and return one-time recovery codes."""
    data = request.get_json(silent=True) or {}
    code = data.get('code')
    if not isinstance(code, str) or not code.strip():
        return jsonify({"error": "code is required"}), 400

    user = User.query.get(get_jwt_identity())
    if not user:
        return jsonify({"error": "User not found"}), 404

    try:
        recovery_codes = two_factor.verify_enrollment(user, code.strip())
    except ValueError as e:
        log_action(
            'user.2fa_enroll_verify',
            user_id=user.id,
            user_email=user.email,
            status='failure',
            extra={'reason': str(e)},
        )
        db.session.commit()
        return jsonify({"error": str(e)}), 400

    log_action('user.2fa_enroll_verify', user_id=user.id, user_email=user.email)
    db.session.commit()
    return jsonify({
        "enrolled": True,
        "recovery_codes": recovery_codes,
    })


@bp.route('/disable', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
@limiter.limit("10 per minute")
def disable():
    """Disable 2FA on the current user's account. Requires the account
    password as proof-of-identity so a stolen access token alone can't drop
    the second factor. If the system-wide toggle is on the user will be
    forced back through enrollment on their next login."""
    data = request.get_json(silent=True) or {}
    password = data.get('password')
    if not isinstance(password, str) or not password:
        return jsonify({"error": "password is required"}), 400

    user = User.query.get(get_jwt_identity())
    if not user:
        return jsonify({"error": "User not found"}), 404
    if not two_factor.is_enrolled(user):
        return jsonify({"error": "Not enrolled in 2FA"}), 400
    # Belt-and-suspenders with the frontend gate: when the admin has 2FA
    # required, users can't drop their second factor — they'd just be forced
    # to re-enroll on the next login anyway.
    if settings_service.get_two_factor_required():
        log_action(
            'user.2fa_disable',
            user_id=user.id,
            user_email=user.email,
            status='failure',
            extra={'reason': 'required_by_policy'},
        )
        db.session.commit()
        return jsonify({"error": "Two-factor is required by your administrator and can't be disabled."}), 403
    if not check_password_hash(user.password, password):
        log_action(
            'user.2fa_disable',
            user_id=user.id,
            user_email=user.email,
            status='failure',
            extra={'reason': 'invalid_password'},
        )
        db.session.commit()
        return jsonify({"error": "Password is incorrect"}), 401

    two_factor.disable(user)
    log_action('user.2fa_disable', user_id=user.id, user_email=user.email)
    db.session.commit()
    return jsonify({"enrolled": False})


@bp.route('/recovery-codes/regenerate', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
@limiter.limit("10 per minute")
def regenerate_recovery_codes():
    """Invalidate the user's existing recovery codes and issue a fresh batch.
    Requires the account password — same reasoning as /disable."""
    data = request.get_json(silent=True) or {}
    password = data.get('password')
    if not isinstance(password, str) or not password:
        return jsonify({"error": "password is required"}), 400

    user = User.query.get(get_jwt_identity())
    if not user:
        return jsonify({"error": "User not found"}), 404
    if not two_factor.is_enrolled(user):
        return jsonify({"error": "Not enrolled in 2FA"}), 400
    if not check_password_hash(user.password, password):
        log_action(
            'user.2fa_recovery_regenerate',
            user_id=user.id,
            user_email=user.email,
            status='failure',
            extra={'reason': 'invalid_password'},
        )
        db.session.commit()
        return jsonify({"error": "Password is incorrect"}), 401

    codes = two_factor.regenerate_recovery_codes(user)
    log_action('user.2fa_recovery_regenerate', user_id=user.id, user_email=user.email)
    db.session.commit()
    return jsonify({"recovery_codes": codes})
