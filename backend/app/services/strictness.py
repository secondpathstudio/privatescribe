"""Strictness levels for structured-template runs.

Mirrors PrivateScribe Studio's lib/strictness.ts. The numeric 0-100 value a
template/field carries maps to a named level (Creative/Balanced/Careful/Strict);
each level packs a runtime config bundle (temperature, mode, refuse policy).

The dispatcher in routes/structured_runtime.py uses .mode to choose between the
single-call markdown skeleton flow and the per-field flow. Prompt builders use
the rest of the bundle to shape the actual Ollama calls.

Keep the level names + boundaries in sync with the builder; the wire format
embeds these as `strictness: number` so a Studio bump that moves the cut-offs
silently changes per-field behavior on imported templates.
"""
from dataclasses import dataclass
from typing import Literal

Mode = Literal['single-call', 'per-field']
LevelName = Literal['Creative', 'Balanced', 'Careful', 'Strict']


@dataclass(frozen=True)
class Runtime:
    temperature: float
    mode: Mode
    # 0-1. In strict mode, hedge-detected fields below this score are blanked
    # and flagged for review. In other modes, advisory.
    confidence_threshold: float
    schema_validation: bool
    refuse_if_uncertain: bool


@dataclass(frozen=True)
class StrictnessLevel:
    name: LevelName
    # Exclusive upper bound. 101 sentinel = "open-ended top".
    upper_bound: int
    runtime: Runtime


STRICTNESS_LEVELS: list[StrictnessLevel] = [
    StrictnessLevel(
        name='Creative',
        upper_bound=25,
        runtime=Runtime(
            temperature=0.7,
            mode='single-call',
            confidence_threshold=0.0,
            schema_validation=False,
            refuse_if_uncertain=False,
        ),
    ),
    StrictnessLevel(
        name='Balanced',
        upper_bound=50,
        runtime=Runtime(
            temperature=0.4,
            mode='single-call',
            confidence_threshold=0.4,
            schema_validation=True,
            refuse_if_uncertain=False,
        ),
    ),
    StrictnessLevel(
        name='Careful',
        upper_bound=75,
        runtime=Runtime(
            temperature=0.2,
            mode='per-field',
            confidence_threshold=0.55,
            schema_validation=True,
            refuse_if_uncertain=False,
        ),
    ),
    StrictnessLevel(
        name='Strict',
        upper_bound=101,
        runtime=Runtime(
            temperature=0.1,
            mode='per-field',
            confidence_threshold=0.7,
            schema_validation=True,
            refuse_if_uncertain=True,
        ),
    ),
]


def clamp_strictness(value) -> int:
    """Coerce arbitrary input into a 0-100 int. Non-numeric defaults to 50 (Balanced)."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 50
    return max(0, min(100, n))


def level_for(value) -> StrictnessLevel:
    """Return the strictness level for a 0-100 numeric value."""
    n = clamp_strictness(value)
    for lvl in STRICTNESS_LEVELS:
        if n < lvl.upper_bound:
            return lvl
    return STRICTNESS_LEVELS[-1]


def effective_strictness(field: dict, template_strictness) -> int:
    """A field's strictnessOverride wins if set, otherwise inherit template."""
    override = field.get('strictnessOverride')
    if isinstance(override, int) and not isinstance(override, bool) and 0 <= override <= 100:
        return override
    return clamp_strictness(template_strictness)
