"""Short-lived signed tokens for the in-progress login flow.

After /api/login validates a password, we issue one of these instead of a
full access token when 2FA gates the session — the user must come back with
a TOTP code (or complete enrollment) to exchange this for the real token
pair. Distinct from JWT access tokens so a leaked challenge token can't be
used against any other API endpoint.

Signed with the JWT secret via itsdangerous (already a Flask dep). Payload
is `{uid, purpose}`; `purpose` distinguishes a code challenge from a forced
enrollment so the two flows can't be confused.
"""
from typing import Literal

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

PURPOSE_2FA_CHALLENGE = "2fa_challenge"
PURPOSE_2FA_ENROLLMENT = "2fa_enrollment"

# How long the user has to finish the second step. Generous enough to scan
# a QR + enter a code, short enough that a leaked token is near-useless.
DEFAULT_TTL_SECONDS = 600  # 10 minutes


def _serializer() -> URLSafeTimedSerializer:
    secret = current_app.config["JWT_SECRET_KEY"]
    return URLSafeTimedSerializer(secret, salt="login-challenge")


def issue(user_id: str, purpose: Literal["2fa_challenge", "2fa_enrollment"]) -> str:
    return _serializer().dumps({"uid": user_id, "purpose": purpose})


def verify(token: str, expected_purpose: Literal["2fa_challenge", "2fa_enrollment"]) -> str:
    """Return the user_id encoded in the token, or raise ValueError."""
    if not isinstance(token, str) or not token:
        raise ValueError("token is required")
    try:
        payload = _serializer().loads(token, max_age=DEFAULT_TTL_SECONDS)
    except SignatureExpired:
        raise ValueError("Login challenge expired. Please sign in again.")
    except BadSignature:
        raise ValueError("Invalid login challenge token.")

    if not isinstance(payload, dict):
        raise ValueError("Malformed challenge token.")
    if payload.get("purpose") != expected_purpose:
        raise ValueError("Challenge token has wrong purpose.")

    uid = payload.get("uid")
    if not isinstance(uid, str) or not uid:
        raise ValueError("Malformed challenge token.")
    return uid
