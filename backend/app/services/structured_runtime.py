"""Runtime for executing structured (Studio) templates against a transcript.

Two execution modes, picked from the strictness level of the template
(and overridden per-field when the field carries its own strictnessOverride):

  single-call  — compile the field tree to a Markdown skeleton with
                 {{instructions}} placeholders and run it through the existing
                 generate_markdown() pipeline. Fast, single Ollama call. Used by
                 Creative and Balanced.
  per-field    — walk fields sequentially, prompting Ollama once per field with
                 the transcript + prior-filled values. Hedge-phrase heuristic
                 marks low-confidence fills; refuseIfUncertain blanks them.
                 Used by Careful and Strict.

The dispatcher in routes/structured_runtime.py picks. This module exports
the building blocks (compile_to_skeleton + run_per_field) but does not commit
notes — that's the route handler's job.
"""
from __future__ import annotations

import re
from typing import Any, Iterator

import ollama

from app.services.strictness import (
    clamp_strictness,
    effective_strictness,
    level_for,
)


# ----------------------------------------------------------------------------
# Single-call mode: compile structured tree -> markdown skeleton with {{...}}
# ----------------------------------------------------------------------------

def _default_instruction(field: dict) -> str:
    """Fallback prompt text for fields that don't carry a customPrompt.

    Tuned per field type — paragraph fields ask for a summary, checklists ask
    for a subset of options, etc. Kept terse so the LLM has room for actual
    content. The label flows in as context.
    """
    label = field.get('label') or field.get('variableKey') or 'this field'
    ftype = field.get('type')
    options = field.get('options') or []
    option_labels = [o.get('label', '') for o in options if isinstance(o, dict)]
    options_str = ', '.join(o for o in option_labels if o)

    if ftype == 'text':
        return f"Extract {label} as a short string."
    if ftype == 'paragraph':
        return f"Summarize {label} from the transcript in one short paragraph."
    if ftype == 'dropdown':
        return f"Pick exactly one of: {options_str}. Return only the option label."
    if ftype == 'checklist':
        # Synonym matching is critical for clinical/legal templates where the
        # speaker rarely uses the canonical option name. Without the explicit
        # nudge, llama tends to require literal string matches.
        return (
            f"From this set, list which items were mentioned in the transcript. "
            f"Common synonyms and clinical equivalents count as matches "
            f"(for example: \"high blood pressure\" matches \"Hypertension\", "
            f"\"HTN\" matches \"Hypertension\", \"family history of heart attack\" "
            f"matches \"Family history of cardiac disease\"). "
            f"Options: {options_str}."
        )
    if ftype == 'bullets':
        return f"List items mentioned for {label}, one per bullet."
    if ftype == 'date':
        return f"Extract {label} as MM/DD/YYYY."
    if ftype == 'number':
        return f"Extract {label} as a number."
    return f"Provide {label}."


def _field_instruction(field: dict) -> str:
    """customPrompt wins if non-empty, otherwise the per-type default."""
    custom = field.get('customPrompt')
    if isinstance(custom, str) and custom.strip():
        return custom.strip()
    return _default_instruction(field)


# Tokens the simple-template system prompt uses to delimit the skeleton.
# llama 3.2 occasionally echoes them in its output despite the "don't add
# extras" rule. We strip them on the way out so the user never sees them.
_FRAMING_LINE = re.compile(
    r"^\s*#{2,4}\s*(START|END)\s+TEMPLATE\s*#{2,4}\s*$",
    re.IGNORECASE,
)


def sanitize_single_call_output(markdown: str) -> str:
    """Drop any echoed `### START/END TEMPLATE ###` lines and collapse the
    trailing whitespace they leave behind. Idempotent and safe to apply to
    clean output (lines that don't match are passed through verbatim).
    """
    if not markdown:
        return markdown
    cleaned_lines = [
        line for line in markdown.splitlines() if not _FRAMING_LINE.match(line)
    ]
    # Collapse runs of blank lines to keep markdown tidy after the strip.
    out: list[str] = []
    prev_blank = False
    for line in cleaned_lines:
        is_blank = line.strip() == ""
        if is_blank and prev_blank:
            continue
        out.append(line)
        prev_blank = is_blank
    return "\n".join(out).strip() + "\n"


def compile_to_skeleton(structured: dict) -> str:
    """Render a structured template as a Markdown skeleton with {{instructions}}.

    autoFill=false fields render a manual-entry placeholder with no instruction
    so the LLM leaves them alone — the user fills them by hand later.
    """
    lines: list[str] = []
    sections = structured.get('sections') or []
    for section in sections:
        title = section.get('title') or 'Section'
        lines.append(f"## {title}")
        lines.append("")
        for field in section.get('fields') or []:
            label = field.get('label') or field.get('variableKey') or 'Field'
            lines.append(f"**{label}**")
            if field.get('autoFill') is False:
                lines.append("_Manually entered._")
            else:
                lines.append("{{" + _field_instruction(field) + "}}")
            lines.append("")
        lines.append("")
    # Drop trailing blank lines for tidiness; the generator still wraps in its
    # own framing so this is purely aesthetic.
    return "\n".join(lines).rstrip() + "\n"


# ----------------------------------------------------------------------------
# Per-field mode: walk the tree, call Ollama per field, chain context forward
# ----------------------------------------------------------------------------

# Phrases the model uses when it doesn't actually know. Hit rate is the
# heuristic for "low confidence" since llama 3.2 self-rating is noisy.
_HEDGE_PATTERNS = [
    r"\bnot (mention|stat|specif|provid|clear|sure)",
    r"\bunclear\b",
    r"\bappears? to\b",
    r"\bseems? to\b",
    r"\bpossibly\b",
    r"\bperhaps\b",
    r"\bunknown\b",
    r"\bcouldn'?t (find|determine|tell)",
    r"\bno (mention|information|data)\b",
    r"\binsufficient (info|information|data|context)\b",
    r"\bcannot (determine|tell|extract)",
    r"\bi (don'?t|do not) (know|have)",
]
_HEDGE_REGEX = re.compile("|".join(_HEDGE_PATTERNS), re.IGNORECASE)


def _hedge_confidence(value: str) -> float:
    """0.0 if any hedge phrase, otherwise 1.0. Cheap, deterministic, surprisingly
    effective on small models — they tend to hedge in stock phrases rather than
    risk being wrong. Calibration is binary on purpose; finer-grained scores
    aren't reliable enough on 3B models to be worth the complexity.
    """
    if not value or not value.strip():
        return 0.0
    return 0.0 if _HEDGE_REGEX.search(value) else 1.0


def _per_field_system_prompt(field: dict, level_name: str) -> str:
    """The system message for a single-field extraction call."""
    ftype = field.get('type', 'text')
    # Stronger contract on what NOT to produce. llama 3.2 tends to pad with
    # restated context and preambles ("The HPI is:", "Based on the transcript:")
    # when given a permissive base prompt. Explicit negative examples land
    # better than abstract rules.
    base = (
        "You are a precise field extractor. Return ONLY the value for the requested "
        "field, in plain text, then stop. Do NOT include: a preamble (\"The HPI is...\", "
        "\"Based on the transcript...\"), the field label, restated context from the "
        "transcript, commentary, explanation, code fences, or wrapping quotes (unless "
        "the value itself is a quote). Output exactly one answer."
    )
    type_hint = {
        'text': "Return a single short line.",
        'paragraph': (
            "Return ONE paragraph of 2-4 sentences. Do not write a second paragraph. "
            "Do not restate the transcript as background — just the field's content."
        ),
        'dropdown': "Return exactly one option label, nothing else.",
        'checklist': (
            "Return a comma-separated list of matched items on a single line. "
            "Use the exact option labels as given (not the speaker's wording). "
            "If nothing matched, return 'None'."
        ),
        'bullets': "Return only the items, one per line prefixed with '- '. No summary line.",
        'date': "Return the date as MM/DD/YYYY, nothing else.",
        'number': "Return a number with no units or commentary.",
    }.get(ftype, "Return the field's value.")
    posture = {
        'Creative': "If uncertain, fill your best plausible guess based on context.",
        'Balanced': "If something is implied but not stated, you may infer it. Keep close to the transcript.",
        'Careful': "Stay close to the transcript wording. Avoid inferences beyond what was clearly said.",
        'Strict': (
            "Quote the speaker's exact words when possible. "
            "If the field is not clearly stated in the transcript, "
            "respond with: 'not mentioned'."
        ),
    }.get(level_name, "")
    return f"{base}\n\n{type_hint}\n\n{posture}".strip()


def _build_field_user_prompt(
    field: dict,
    transcript: str,
    prior_fills: list[tuple[str, str]],
) -> str:
    """User message: transcript + prior filled fields + this field's instruction."""
    instruction = _field_instruction(field)
    label = field.get('label') or field.get('variableKey') or 'this field'

    parts = [f"### Transcript\n{transcript.strip()}"]

    if prior_fills:
        # Chained context — earlier fields' filled values give later fields
        # something to build on (e.g., Impression after HPI). Capped at the
        # last 6 fills to keep prompts from ballooning on long templates.
        recent = prior_fills[-6:]
        ctx = "\n".join(f"- {lbl}: {val}" for lbl, val in recent if val)
        if ctx:
            parts.append(f"### Already filled fields (for context)\n{ctx}")

    parts.append(f"### Field to extract\n{label}\n\n{instruction}")
    return "\n\n".join(parts)


def _strip_to_value(raw: str) -> str:
    """Clean up the model's response. Most reliable trick: drop wrapping quotes
    and trailing 'newlines + commentary' if the model started chatting.
    """
    s = (raw or "").strip()
    # Strip surrounding matching quotes
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        s = s[1:-1].strip()
    return s


def run_per_field(
    structured: dict,
    transcript: str,
    model_name: str,
    template_strictness: int,
) -> Iterator[dict]:
    """Yield one event per stage of a per-field run.

    Event kinds:
      {kind: 'field_start',    fieldId, label, variableKey}
      {kind: 'field_complete', fieldId, value, confidence, flagged, latencyMs}
      {kind: 'field_skipped',  fieldId, reason}   # autoFill=false
      {kind: 'field_error',    fieldId, message}  # Ollama call blew up
      {kind: 'complete',       markdown}          # final compiled note

    Caller is responsible for emitting these to the wire (NDJSON) and any
    follow-up persistence.
    """
    import time

    sections = structured.get('sections') or []
    # variable_key -> filled value, for the final markdown assembly
    fills: dict[str, dict[str, Any]] = {}
    # ordered list for chained-context prompts
    prior_fills: list[tuple[str, str]] = []

    for section in sections:
        for field in section.get('fields') or []:
            fid = field.get('id')
            label = field.get('label') or field.get('variableKey') or 'Field'
            vkey = field.get('variableKey') or fid

            if field.get('autoFill') is False:
                fills[vkey] = {'value': '', 'flagged': False, 'manual': True, 'label': label}
                yield {'kind': 'field_skipped', 'fieldId': fid, 'reason': 'manual'}
                continue

            yield {'kind': 'field_start', 'fieldId': fid, 'label': label, 'variableKey': vkey}

            eff = effective_strictness(field, template_strictness)
            lvl = level_for(eff)
            system = _per_field_system_prompt(field, lvl.name)
            user = _build_field_user_prompt(field, transcript, prior_fills)

            t0 = time.monotonic()
            try:
                resp = ollama.chat(
                    model=model_name,
                    messages=[
                        {'role': 'system', 'content': system},
                        {'role': 'user', 'content': user},
                    ],
                    options={'temperature': lvl.runtime.temperature},
                )
                raw = resp['message']['content']
            except Exception as e:
                yield {
                    'kind': 'field_error',
                    'fieldId': fid,
                    'message': f"{type(e).__name__}: {e}",
                }
                # Flag-and-continue: blank fill + flagged so the user sees it.
                fills[vkey] = {'value': '', 'flagged': True, 'manual': False, 'label': label}
                continue

            latency_ms = int((time.monotonic() - t0) * 1000)
            value = _strip_to_value(raw)
            confidence = _hedge_confidence(value)
            flagged = False

            if lvl.runtime.refuse_if_uncertain and confidence < lvl.runtime.confidence_threshold:
                # Strict policy: blank low-confidence fields rather than emit
                # potentially-wrong content. The user sees the flag in the UI.
                value = ''
                flagged = True

            fills[vkey] = {'value': value, 'flagged': flagged, 'manual': False, 'label': label}
            if value:
                prior_fills.append((label, value))

            yield {
                'kind': 'field_complete',
                'fieldId': fid,
                'value': value,
                'confidence': confidence,
                'flagged': flagged,
                'latencyMs': latency_ms,
            }

    yield {'kind': 'complete', 'markdown': _assemble_markdown(structured, fills)}


def _assemble_markdown(structured: dict, fills: dict[str, dict[str, Any]]) -> str:
    """Render the filled tree as markdown. Mirrors compile_to_skeleton's shape
    but with values instead of {{instructions}}. Flagged fields render a
    review marker so the user can spot them.
    """
    lines: list[str] = []
    sections = structured.get('sections') or []
    for section in sections:
        title = section.get('title') or 'Section'
        lines.append(f"## {title}")
        lines.append("")
        for field in section.get('fields') or []:
            label = field.get('label') or field.get('variableKey') or 'Field'
            vkey = field.get('variableKey') or field.get('id')
            fill = fills.get(vkey, {})
            lines.append(f"**{label}**")
            if fill.get('manual'):
                lines.append("_(manual entry)_")
            elif fill.get('flagged'):
                lines.append(f"_⚠ Needs review — model was uncertain._")
                if fill.get('value'):
                    lines.append(fill['value'])
            else:
                lines.append(fill.get('value') or '_(empty)_')
            lines.append("")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
