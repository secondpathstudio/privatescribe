from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (create_access_token, create_refresh_token,
                                get_jwt, get_jwt_identity, jwt_required)
from werkzeug.security import check_password_hash

from app.extensions import db, limiter
from app.models import User
from app.security import account_lockout, login_challenge, sessions
from app.security.secrets import is_backup_key_acknowledged
from app.services import settings as settings_service
from app.services import two_factor
from app.services.audit import log_action

bp = Blueprint("auth", __name__)


def _pending_backup_key_ack(user) -> bool:
    """True when this user needs to nudge through the backup-key flow.
    Currently any admin who hasn't acknowledged the key (or hasn't since the
    last rotation) — non-admins never see the banner."""
    return user.role == 'admin' and not is_backup_key_acknowledged()


def _user_payload(user) -> dict:
    """The user object the frontend caches in localStorage. Shared by login
    and /api/validateToken so the two can't drift."""
    return {
        "id": user.id,
        "email": user.email,
        "firstName": user.first_name,
        "lastName": user.last_name,
        "role": user.role,
        "organization": (
            {"id": user.organization.id, "name": user.organization.name}
            if user.organization else None
        ),
        "lastLogin": user.last_login,
        "forcePasswordChange": user.force_password_change,
        "hasOnboarded": user.has_onboarded,
        "pendingBackupKeyAcknowledgment": _pending_backup_key_ack(user),
        "logoutOnClose": settings_service.get_logout_on_close(),
        "exportsEnabled": settings_service.get_exports_enabled(),
        "dictationMarkersEnabled": settings_service.get_dictation_markers_enabled(),
        "idleTimeoutMinutes": settings_service.get_session_idle_timeout_minutes(),
    }


def _build_login_response(user):
    """Issue the final access+refresh token pair and the user payload that
    the frontend caches in localStorage. Called from /api/login when 2FA is
    not required, and from /api/login/2fa and /api/login/2fa-enroll-verify
    once the second factor is satisfied.

    Creates the server-side Session row and stamps its id into both tokens as
    the `sid` claim — the request guard validates that row on every call, so
    logout / idle timeout / deactivation can revoke access immediately."""
    session = sessions.start_session(user.id)
    claims = {"sid": session.id}
    access_token = create_access_token(identity=user.id, additional_claims=claims)
    refresh_token = create_refresh_token(identity=user.id, additional_claims=claims)
    user.last_login = datetime.utcnow()
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": _user_payload(user),
    }


@bp.route('/api/validateToken', methods=['GET'])
@jwt_required()
def validate_token():
    user = User.query.get(get_jwt_identity())
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({
        "message": "Valid token",
        "user": _user_payload(user),
    })


@bp.route('/api/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data = request.get_json(silent=True) or {}

    if not data.get('email') or not data.get('password'):
        return jsonify({"error": "Email and password are required"}), 400

    attempted_email = data['email']
    user = User.query.filter_by(email=attempted_email).first()

    # Brute-force backstop: a locked account is refused before the password is
    # checked at all, so a correct guess landed mid-lockout still can't get in.
    if user and account_lockout.is_locked(user):
        log_action(
            'auth.login_failed',
            user_id=user.id,
            user_email=user.email,
            status='failure',
            extra={'reason': 'account_locked'},
        )
        db.session.commit()
        return jsonify({"error": account_lockout.lockout_message(user)}), 403

    if user and check_password_hash(user.password, data['password']):
        # A deactivated account can't sign in — stop before 2FA / token issue.
        if not user.is_active:
            log_action(
                'auth.login_failed',
                user_id=user.id,
                user_email=user.email,
                status='failure',
                extra={'reason': 'account_deactivated'},
            )
            db.session.commit()
            return jsonify({
                "error": "This account has been deactivated. Contact an administrator.",
            }), 403
        # Correct password — clear any accumulated failed-attempt count so a
        # past run of misses doesn't carry toward a future lockout. Done before
        # the 2FA branches so it applies even when the token pair is deferred.
        account_lockout.register_success(user)
        # 2FA precedence:
        # 1. If the user has opted in (enrolled), always challenge them, even
        #    when the org-wide toggle is off. A self-enabled second factor
        #    stays active regardless of admin policy.
        # 2. Otherwise, if the admin requires 2FA globally, force enrollment
        #    mid-login.
        # 3. Otherwise, plain password login.
        # In cases 1 and 2 we defer the access/refresh pair and last_login
        # bump until the second step completes.
        if two_factor.is_enrolled(user):
            token = login_challenge.issue(user.id, login_challenge.PURPOSE_2FA_CHALLENGE)
            log_action(
                'auth.login_password_ok',
                user_id=user.id,
                user_email=user.email,
                extra={'next_step': '2fa_challenge'},
            )
            db.session.commit()
            return jsonify({
                "requires_2fa": True,
                "challenge_token": token,
            }), 200

        if settings_service.get_two_factor_required():
            token = login_challenge.issue(user.id, login_challenge.PURPOSE_2FA_ENROLLMENT)
            log_action(
                'auth.login_password_ok',
                user_id=user.id,
                user_email=user.email,
                extra={'next_step': '2fa_enrollment'},
            )
            db.session.commit()
            return jsonify({
                "requires_2fa_enrollment": True,
                "enrollment_token": token,
            }), 200

        response_body = _build_login_response(user)
        log_action('auth.login', user_id=user.id, user_email=user.email)
        db.session.commit()
        return jsonify(response_body), 200

    # Count this miss against the account (if the email matched one). A return
    # value of True means this attempt is the one that tripped the threshold.
    just_locked = account_lockout.register_failure(user) if user else False
    log_action(
        'auth.login_failed',
        user_id=user.id if user else None,
        user_email=attempted_email,
        status='failure',
        extra={
            'reason': 'invalid_password' if user else 'unknown_email',
        },
    )
    if just_locked:
        log_action(
            'auth.account_locked',
            user_id=user.id,
            user_email=user.email,
            status='failure',
            extra={
                'locked_until': user.locked_until.isoformat(),
                'threshold': settings_service.get_account_lockout_threshold(),
                'lockout_minutes': settings_service.get_account_lockout_minutes(),
            },
        )
    db.session.commit()
    if just_locked:
        return jsonify({"error": account_lockout.lockout_message(user)}), 403
    return jsonify({"error": "Invalid username or password"}), 401


@bp.route('/api/login/2fa', methods=['POST'])
@limiter.limit("10 per minute")
def login_2fa():
    """Second step of password+TOTP login. Body: {challenge_token, code}.
    `code` may be a 6-digit TOTP or a recovery code. On success returns the
    same shape as /api/login."""
    data = request.get_json(silent=True) or {}
    challenge_token = data.get('challenge_token')
    code = data.get('code')

    try:
        user_id = login_challenge.verify(challenge_token, login_challenge.PURPOSE_2FA_CHALLENGE)
    except ValueError as e:
        return jsonify({"error": str(e)}), 401

    if not isinstance(code, str) or not code.strip():
        return jsonify({"error": "code is required"}), 400

    user = User.query.get(user_id)
    if not user or not user.is_active or not two_factor.is_enrolled(user):
        return jsonify({"error": "Invalid challenge."}), 401

    if not two_factor.verify_login_code(user, code):
        log_action(
            'auth.login_2fa',
            user_id=user.id,
            user_email=user.email,
            status='failure',
            extra={'reason': 'invalid_code'},
        )
        db.session.commit()
        return jsonify({"error": "Invalid code"}), 401

    response_body = _build_login_response(user)
    log_action('auth.login', user_id=user.id, user_email=user.email, extra={'second_factor': 'totp'})
    db.session.commit()
    return jsonify(response_body), 200


@bp.route('/api/login/2fa-enroll', methods=['POST'])
@limiter.limit("10 per minute")
def login_2fa_enroll():
    """Mid-login enrollment, step 1. Issues a fresh TOTP secret + QR for a
    user the admin's policy has forced into 2FA. Body: {enrollment_token}."""
    data = request.get_json(silent=True) or {}
    enrollment_token = data.get('enrollment_token')

    try:
        user_id = login_challenge.verify(enrollment_token, login_challenge.PURPOSE_2FA_ENROLLMENT)
    except ValueError as e:
        return jsonify({"error": str(e)}), 401

    user = User.query.get(user_id)
    if not user or not user.is_active:
        return jsonify({"error": "Invalid enrollment session."}), 401
    if two_factor.is_enrolled(user):
        # Shouldn't happen in normal flow — /api/login routes enrolled users
        # to the challenge path. Race or replay; safest to bounce them back
        # to the password screen.
        return jsonify({"error": "Already enrolled. Please sign in again."}), 400

    try:
        secret, uri, qr = two_factor.start_enrollment(user)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    log_action('user.2fa_enroll_start', user_id=user.id, user_email=user.email, extra={'via': 'login'})
    db.session.commit()
    return jsonify({
        "secret": secret,
        "provisioning_uri": uri,
        "qr_data_url": qr,
        # Echo the token so the client uses the same one for step 2.
        "enrollment_token": enrollment_token,
    })


@bp.route('/api/login/2fa-enroll-verify', methods=['POST'])
@limiter.limit("10 per minute")
def login_2fa_enroll_verify():
    """Mid-login enrollment, step 2. Body: {enrollment_token, code}. Confirms
    the first code, marks the user enrolled, and returns the same shape as
    /api/login plus the one-time recovery codes."""
    data = request.get_json(silent=True) or {}
    enrollment_token = data.get('enrollment_token')
    code = data.get('code')

    try:
        user_id = login_challenge.verify(enrollment_token, login_challenge.PURPOSE_2FA_ENROLLMENT)
    except ValueError as e:
        return jsonify({"error": str(e)}), 401

    if not isinstance(code, str) or not code.strip():
        return jsonify({"error": "code is required"}), 400

    user = User.query.get(user_id)
    if not user or not user.is_active:
        return jsonify({"error": "Invalid enrollment session."}), 401

    try:
        recovery_codes = two_factor.verify_enrollment(user, code.strip())
    except ValueError as e:
        log_action(
            'user.2fa_enroll_verify',
            user_id=user.id,
            user_email=user.email,
            status='failure',
            extra={'via': 'login', 'reason': str(e)},
        )
        db.session.commit()
        return jsonify({"error": str(e)}), 400

    response_body = _build_login_response(user)
    response_body["recovery_codes"] = recovery_codes
    log_action('user.2fa_enroll_verify', user_id=user.id, user_email=user.email, extra={'via': 'login'})
    log_action('auth.login', user_id=user.id, user_email=user.email, extra={'second_factor': 'totp_first_enroll'})
    db.session.commit()
    return jsonify(response_body), 200


@bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    current_user = get_jwt_identity()
    # The request guard can't see refresh tokens, so /refresh validates its
    # own session: a revoked, idle-expired, or deactivated session can't be
    # used to mint a fresh access token.
    sid = get_jwt().get('sid')
    session = sessions.get_session(sid)
    if session is None or session.revoked:
        return jsonify({
            "error": "Your session has ended. Please sign in again.",
            "code": "session_revoked",
        }), 401
    if sessions.is_idle_expired(session):
        sessions.revoke_session(session, 'idle_timeout')
        db.session.commit()
        return jsonify({
            "error": "Signed out due to inactivity. Please sign in again.",
            "code": "session_timeout",
        }), 401
    user = User.query.get(current_user)
    if not user or not user.is_active:
        sessions.revoke_session(session, 'user_deactivated')
        db.session.commit()
        return jsonify({
            "error": "This account is no longer active.",
            "code": "account_deactivated",
        }), 401
    sessions.touch(session)
    new_access_token = create_access_token(
        identity=current_user, additional_claims={"sid": sid}
    )
    log_action('auth.token_refresh', user_id=current_user)
    db.session.commit()
    return jsonify(access_token=new_access_token)


@bp.route('/api/logout', methods=['POST'])
@jwt_required()
def logout():
    """Revoke the current session server-side. The frontend still clears its
    stored tokens; this is what makes the token itself stop working."""
    session = sessions.get_session(get_jwt().get('sid'))
    if session and not session.revoked:
        sessions.revoke_session(session, 'logout')
        log_action('auth.logout', user_id=get_jwt_identity())
        db.session.commit()
    return jsonify({"message": "Logged out"}), 200
