"""TOTP-based two-factor authentication helpers.

Pure-function module — the route handlers in `app/routes/two_factor.py` call
these to manipulate the per-user TOTP secret and recovery-code list. All
persistence happens on the `User` row (`totp_secret`, `totp_enrolled_at`,
`recovery_codes`); this module just owns the crypto and serialization.

`totp_enrolled_at` is the source of truth for "is this user enrolled". A
non-null `totp_secret` with a null `totp_enrolled_at` means an in-flight
enrollment that hasn't been verified yet — calling `start_enrollment` again
overwrites it.
"""
import base64
import io
import json
import secrets
from datetime import datetime
from typing import Optional

import pyotp
import qrcode
from werkzeug.security import check_password_hash, generate_password_hash

# Display name in the authenticator app's account list.
ISSUER = "PrivateScribe"

# Number of recovery codes generated at enrollment / regeneration. 10 matches
# what GitHub/Google hand out — enough for one-off use without being unwieldy
# to print on a recovery sheet.
RECOVERY_CODE_COUNT = 10

# Allowed ± clock-drift in 30s steps when verifying a code. 1 gives ~90s of
# tolerance which covers normal phone/server clock skew without widening the
# brute-force window much.
TOTP_VALID_WINDOW = 1


def is_enrolled(user) -> bool:
    return user.totp_enrolled_at is not None


def start_enrollment(user) -> tuple[str, str, str]:
    """Generate a fresh TOTP secret for the user (overwriting any pending
    unverified one) and return (secret_b32, provisioning_uri, qr_png_data_url).

    Refuses if the user is already enrolled — they must disable first.
    Persistence (db.session.commit()) is the caller's responsibility.
    """
    if is_enrolled(user):
        raise ValueError("User is already enrolled in 2FA")

    secret = pyotp.random_base32()
    user.totp_secret = secret
    user.totp_enrolled_at = None  # stays null until verify_enrollment succeeds

    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=ISSUER)
    qr_data_url = _qr_png_data_url(uri)
    return secret, uri, qr_data_url


def verify_enrollment(user, code: str) -> list[str]:
    """Confirm the first TOTP code from the user's authenticator app. Marks
    the user enrolled, generates fresh recovery codes, returns the plaintext
    codes (shown to the user exactly once).
    """
    if not user.totp_secret:
        raise ValueError("No pending enrollment — call /api/2fa/enroll first")
    if is_enrolled(user):
        raise ValueError("User is already enrolled in 2FA")
    if not _verify_totp(user.totp_secret, code):
        raise ValueError("Invalid code")

    plaintext_codes = _generate_recovery_codes()
    user.recovery_codes = json.dumps([generate_password_hash(c, method='pbkdf2:sha256') for c in plaintext_codes])
    user.totp_enrolled_at = datetime.utcnow()
    return plaintext_codes


def regenerate_recovery_codes(user) -> list[str]:
    """Replace the user's recovery codes with a fresh batch. Returns the
    plaintext codes (shown once)."""
    if not is_enrolled(user):
        raise ValueError("User is not enrolled in 2FA")
    plaintext_codes = _generate_recovery_codes()
    user.recovery_codes = json.dumps([generate_password_hash(c, method='pbkdf2:sha256') for c in plaintext_codes])
    return plaintext_codes


def disable(user) -> None:
    """Clear all 2FA state on the user. Caller is responsible for whatever
    re-auth gate they want to put in front of this."""
    user.totp_secret = None
    user.totp_enrolled_at = None
    user.recovery_codes = None


def verify_login_code(user, code: str) -> bool:
    """Validate a TOTP code OR consume a recovery code. Returns True on
    success. Recovery-code consumption mutates `user.recovery_codes` in
    place; caller must commit."""
    if not is_enrolled(user) or not user.totp_secret:
        return False

    cleaned = (code or "").strip()
    if not cleaned:
        return False

    # TOTP path — purely numeric 6-digit codes. Tolerate stray whitespace
    # users sometimes paste.
    digits_only = cleaned.replace(" ", "")
    if digits_only.isdigit() and len(digits_only) == 6:
        return _verify_totp(user.totp_secret, digits_only)

    # Recovery-code path. Normalize to the canonical 'XXXXX-XXXXX' form the
    # hashes were computed against so we accept "abcde-fghij", "ABCDEFGHIJ",
    # mixed case, etc.
    normalized = _normalize_recovery_code(cleaned)
    return _consume_recovery_code(user, normalized)


def remaining_recovery_codes(user) -> int:
    if not user.recovery_codes:
        return 0
    try:
        stored = json.loads(user.recovery_codes)
    except (ValueError, TypeError):
        return 0
    return sum(1 for h in stored if h)


def _verify_totp(secret: str, code: str) -> bool:
    try:
        return pyotp.TOTP(secret).verify(code, valid_window=TOTP_VALID_WINDOW)
    except Exception:
        return False


def _consume_recovery_code(user, candidate: str) -> bool:
    """Find a matching unused recovery-code hash, null it out, return True."""
    if not user.recovery_codes:
        return False
    try:
        stored = json.loads(user.recovery_codes)
    except (ValueError, TypeError):
        return False

    matched_index: Optional[int] = None
    for idx, h in enumerate(stored):
        if h and check_password_hash(h, candidate):
            matched_index = idx
            break

    if matched_index is None:
        return False

    stored[matched_index] = None
    user.recovery_codes = json.dumps(stored)
    return True


def _normalize_recovery_code(s: str) -> str:
    """Coerce the user's pasted/typed recovery code into the canonical
    'XXXXX-XXXXX' uppercase form used when the codes were hashed. Tolerates
    case differences, missing dashes, and surrounding whitespace.
    """
    alnum = ''.join(ch for ch in s if ch.isalnum()).upper()
    if len(alnum) == 10:
        return f"{alnum[:5]}-{alnum[5:]}"
    return alnum  # wrong length — let the hash compare fail naturally


def _generate_recovery_codes() -> list[str]:
    # 10-char alphanumeric, formatted as XXXXX-XXXXX for human readability.
    # Excludes visually ambiguous chars (0/O, 1/I/l) so transcription from
    # a printed sheet is less error-prone.
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = ''.join(secrets.choice(alphabet) for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def _qr_png_data_url(uri: str) -> str:
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    return f"data:image/png;base64,{b64}"
