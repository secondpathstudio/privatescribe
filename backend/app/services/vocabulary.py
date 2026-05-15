"""Custom vocabulary and abbreviation expansion for the transcribe pipeline.

Two independent transcript-quality features that share a data shape:

1. **Vocabulary terms** — a list of phrases the user expects to appear in
   the audio (drug names, jargon, person names). Faster-Whisper accepts an
   ``initial_prompt`` that biases recognition toward terms it sees; we
   concatenate the merged list into a single short prompt and pass it in.

2. **Abbreviations** — a ``{short: long}`` map. After Whisper transcribes,
   we replace whole-word occurrences of each ``short`` with its ``long``
   form. Case-insensitive for matching; the long form is rendered literally.

Both have two storage scopes:
- Admin-wide defaults live in the ``system_setting`` table.
- Per-user overlays live as JSON columns on the ``user`` row.

The "effective" value for a given user is the merge of the two: vocabulary
is union+deduped; abbreviations are dict-merged with user keys winning on
collisions (so users can specialize ``BP → bipolar`` even if the admin says
``BP → blood pressure``).
"""
import json
import re

from app.models import User
from app.services import settings as settings_service

# Conservative cap so we don't blow past Faster-Whisper's prompt token limit
# (~224 tokens for the prompt buffer). We measure in characters because the
# precise tokenization differs by model; this is a safe heuristic for the
# `base` model.
_MAX_PROMPT_CHARS = 700

# Split candidates for an "abbreviation textarea" line. We accept the most
# common separators users naturally type. The first capture group is the
# short form; the second is the long form.
_ABBREV_LINE_RE = re.compile(r"^\s*(.+?)\s*(?:=|:|->|→)\s*(.+?)\s*$")


# ---------------------------------------------------------------------------
# Parsing / serialization between user-edited textareas and JSON storage.
# ---------------------------------------------------------------------------

def parse_vocabulary_textarea(text: str) -> list[str]:
    """Parse a newline-separated vocabulary textarea into a deduped list,
    preserving the order in which terms first appeared."""
    if not text:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for line in text.splitlines():
        term = line.strip()
        if not term:
            continue
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(term)
    return out


def serialize_vocabulary(terms: list[str]) -> str:
    return json.dumps(terms)


def parse_abbreviations_textarea(text: str) -> dict[str, str]:
    """Parse a textarea where each line is ``SHORT = LONG`` (also accepts
    ``:`` / ``->`` / ``→`` as separators). Later lines override earlier
    lines on the same short form."""
    if not text:
        return {}
    out: dict[str, str] = {}
    for line in text.splitlines():
        m = _ABBREV_LINE_RE.match(line)
        if not m:
            continue
        short, long = m.group(1), m.group(2)
        if not short or not long:
            continue
        out[short] = long
    return out


def serialize_abbreviations(mapping: dict[str, str]) -> str:
    return json.dumps(mapping)


def format_vocabulary_textarea(terms: list[str]) -> str:
    """Inverse of parse_vocabulary_textarea, for rendering the saved list
    back into the editor."""
    return "\n".join(terms)


def format_abbreviations_textarea(mapping: dict[str, str]) -> str:
    """Inverse of parse_abbreviations_textarea — produces ``SHORT = LONG``
    lines stable in insertion order."""
    return "\n".join(f"{k} = {v}" for k, v in mapping.items())


# ---------------------------------------------------------------------------
# Reading the per-user JSON columns. Tolerant of missing or malformed values
# so a corrupt row never blocks transcription.
# ---------------------------------------------------------------------------

def _user_vocabulary(user: User) -> list[str]:
    raw = user.vocabulary_terms or "[]"
    try:
        value = json.loads(raw)
        if isinstance(value, list):
            return [str(v) for v in value if isinstance(v, str) and v.strip()]
    except (ValueError, TypeError, json.JSONDecodeError):
        pass
    return []


def _user_abbreviations(user: User) -> dict[str, str]:
    raw = user.abbreviations or "{}"
    try:
        value = json.loads(raw)
        if isinstance(value, dict):
            return {
                str(k): str(v)
                for k, v in value.items()
                if isinstance(k, str) and isinstance(v, str) and k.strip()
            }
    except (ValueError, TypeError, json.JSONDecodeError):
        pass
    return {}


def get_user_vocabulary(user_id: str) -> list[str]:
    user = User.query.get(user_id)
    return _user_vocabulary(user) if user else []


def get_user_abbreviations(user_id: str) -> dict[str, str]:
    user = User.query.get(user_id)
    return _user_abbreviations(user) if user else {}


# ---------------------------------------------------------------------------
# Merge admin + user → "effective" values used at transcribe time.
# ---------------------------------------------------------------------------

def get_effective_vocabulary(user_id: str) -> list[str]:
    """Admin list first, then user additions (deduped, case-insensitive)."""
    admin = settings_service.get_admin_vocabulary_terms()
    user_terms = get_user_vocabulary(user_id)
    seen: set[str] = set()
    out: list[str] = []
    for term in [*admin, *user_terms]:
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(term)
    return out


def get_effective_abbreviations(user_id: str) -> dict[str, str]:
    """Admin dict first; user dict overlays (user wins on key conflicts)."""
    merged = dict(settings_service.get_admin_abbreviations())
    merged.update(get_user_abbreviations(user_id))
    return merged


# ---------------------------------------------------------------------------
# Apply at transcribe time.
# ---------------------------------------------------------------------------

def build_whisper_prompt(terms: list[str]) -> str | None:
    """Format a vocabulary list into a single ``initial_prompt`` string.

    Faster-Whisper biases recognition toward terms it has seen in the prompt
    buffer. We frame the list as a sentence so the decoder treats it as
    natural context rather than as something to transcribe back. Returns
    None when there's nothing to bias toward, so callers can skip passing
    the kwarg entirely.
    """
    if not terms:
        return None
    body = ", ".join(terms).strip()
    if not body:
        return None
    prompt = f"Vocabulary: {body}."
    # Trim from the right at a delimiter so we don't leave a half-word.
    if len(prompt) > _MAX_PROMPT_CHARS:
        truncated = prompt[:_MAX_PROMPT_CHARS]
        last_sep = truncated.rfind(",")
        if last_sep > 0:
            truncated = truncated[:last_sep]
        prompt = truncated + "."
    return prompt


def apply_abbreviations(text: str, mapping: dict[str, str]) -> str:
    """Replace whole-word occurrences of each key with its value.

    Case-insensitive match; the replacement is rendered literally as written
    in the mapping. Longer keys are tried before shorter ones so a key like
    ``c/o`` isn't preempted by a one-character key that happens to overlap.
    """
    if not text or not mapping:
        return text
    # Sort by length desc so multi-token keys ("c/o") win over single-char
    # accidents. Stable sort means ties keep insertion order.
    for short, long in sorted(mapping.items(), key=lambda kv: -len(kv[0])):
        short = short.strip()
        long = long.strip()
        if not short or not long:
            continue
        pattern = re.compile(rf"\b{re.escape(short)}\b", re.IGNORECASE)
        text = pattern.sub(long, text)
    return text
