"""Shared password-strength validation.

One validator behind every credential-creation path — admin "create user",
first-run setup, self-service change, admin password reset, and the
`flask create-admin` CLI — so the policy can't be sidestepped by picking a
different entry point (GAP-04).

Strictness is admin-configurable via the `password_policy` system setting:

  standard — length floor only (min 8 chars). Fine for a single-user personal
             install where an awkward password is more friction than the
             threat model warrants.
  strict   — length floor 12, rejects common/breached passwords from an
             embedded blocklist, and requires 3 of 4 character classes. The
             multi-user / professional / HIPAA posture.

Live breach-API screening (e.g. HIBP) isn't possible — the app is fully
offline by design — so "strict" screens against an embedded blocklist of the
high-frequency passwords any offline cracker tries first.
"""
import re

from app.services import settings as settings_service

# Policy names — must match settings_service.VALID_PASSWORD_POLICIES.
POLICY_STANDARD = "standard"
POLICY_STRICT = "strict"

# Length bounds. The floor depends on the active policy; the ceiling is shared
# and exists only to cap the work generate_password_hash does on absurd input.
STANDARD_MIN_LENGTH = 8
STRICT_MIN_LENGTH = 12
MAX_LENGTH = 256

# Minimum distinct character classes (lower / upper / digit / symbol) required
# under the strict policy.
STRICT_MIN_CHAR_CLASSES = 3

# Common / breached passwords rejected outright under the strict policy,
# compared case-insensitively. Not exhaustive — it's the high-frequency tail an
# offline cracker tries first. Includes a few 12+ char entries that would
# otherwise sail past the strict length floor.
_COMMON_PASSWORDS = frozenset({
    "123456", "123456789", "12345678", "1234567890", "1234567",
    "password", "password1", "password12", "password123", "passw0rd",
    "p@ssw0rd", "qwerty", "qwerty123", "qwertyuiop", "111111",
    "123123", "abc123", "iloveyou", "admin", "administrator",
    "welcome", "welcome1", "welcome123", "letmein", "monkey",
    "dragon", "sunshine", "princess", "football", "baseball",
    "superman", "trustno1", "000000", "1q2w3e4r", "1qaz2wsx",
    "zaq12wsx", "changeme", "default", "secret", "master",
    "shadow", "computer", "starwars", "whatever", "google",
    "ollama", "privatescribe", "scribe",
    # 12+ char entries that clear the strict length floor on their own:
    "password1234", "passwordpassword", "123456789012", "qwertyqwerty",
    "iloveyou1234", "welcome123456", "letmein123456", "changeme1234",
    "trustno1234567", "qwertyuiop12", "administrator1",
})


def get_policy() -> str:
    """The active policy name, falling back to the standard policy."""
    return settings_service.get_password_policy()


def min_length(policy: str | None = None) -> int:
    """Minimum acceptable password length under `policy` (defaults to active)."""
    if policy is None:
        policy = get_policy()
    return STRICT_MIN_LENGTH if policy == POLICY_STRICT else STANDARD_MIN_LENGTH


def _char_classes(value: str) -> int:
    classes = 0
    if re.search(r"[a-z]", value):
        classes += 1
    if re.search(r"[A-Z]", value):
        classes += 1
    if re.search(r"[0-9]", value):
        classes += 1
    if re.search(r"[^a-zA-Z0-9]", value):
        classes += 1
    return classes


def validate(password, *, policy: str | None = None) -> str | None:
    """Return a human-readable error if `password` violates the active policy,
    or None if it's acceptable.

    `policy` overrides the stored setting — used by tests and callers that have
    already resolved it; normal callers leave it None so the live setting wins.
    """
    if not isinstance(password, str) or not password:
        return "Password is required"
    if policy is None:
        policy = get_policy()

    floor = min_length(policy)
    if len(password) < floor:
        return f"Password must be at least {floor} characters"
    if len(password) > MAX_LENGTH:
        return f"Password must be {MAX_LENGTH} characters or fewer"

    if policy == POLICY_STRICT:
        if password.lower() in _COMMON_PASSWORDS:
            return "That password is too common — choose something less guessable"
        if _char_classes(password) < STRICT_MIN_CHAR_CLASSES:
            return (
                f"Password must include at least {STRICT_MIN_CHAR_CLASSES} of: "
                "lowercase letters, uppercase letters, digits, symbols"
            )

    return None
