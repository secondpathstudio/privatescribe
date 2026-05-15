"""Post-process Whisper output to honor spoken dictation commands.

After Whisper transcribes audio, the user may have said formatting commands
like "new paragraph" or "comma" expecting them to be applied to the output
rather than left as literal words. This module runs a regex pass over the
transcript before it reaches the LLM (and before it is stored as
`note_content_raw`) and substitutes those phrases for the punctuation or
formatting they describe.

Two patterns, two confidence levels:

1. **Structural breaks** ("new paragraph", "new line") — only substituted
   when the phrase sits at a sentence boundary (preceded by `.`/`!`/`?` or
   the start of the text, followed by the same). Whisper's auto-punctuation
   produces exactly that shape when the speaker pauses and says the command
   as its own utterance, and the boundary requirement avoids rewriting
   "I want to start a new paragraph." mid-sentence.

2. **Punctuation** ("period", "comma") — substituted wherever the literal
   word appears as a standalone token. Faster-Whisper already auto-punctuates
   in most cases, so these mostly catch literal words that survive when
   the user dictates the command explicitly. Trade-off: false positives are
   possible ("recovery period." → "recovery." is wrong). The admin toggle
   `dictation_markers_enabled` is the escape hatch for organizations whose
   recordings contain these words as content.
"""
import re

# Structural markers — require a `.!?` (or start-of-text) sentence boundary
# before the phrase. We apply punctuation markers FIRST so that a spoken
# "...period new paragraph patient..." has its "period" rewritten to "."
# before this pass looks for the boundary.
_STRUCTURAL_MARKERS: list[tuple[re.Pattern[str], str]] = [
    # "new paragraph" → blank line.
    #
    # The leading anchor `(?<=[.!?])\s+|^` is the false-positive guard: the
    # phrase only triggers when it follows a sentence terminator or starts
    # the transcript, so "I want to start a new paragraph in the chart."
    # is left untouched. The trailing `[.!?]*\s*` is intentionally lax —
    # Whisper sometimes emits the command with no trailing period (or one
    # we already consumed in the punctuation pass).
    (
        re.compile(
            r"(?:(?<=[.!?])\s+|^)new paragraph[.!?]*\s*",
            re.IGNORECASE,
        ),
        "\n\n",
    ),
    # "new line" → single line break.
    (
        re.compile(
            r"(?:(?<=[.!?])\s+|^)new line[.!?]*\s*",
            re.IGNORECASE,
        ),
        "\n",
    ),
]

# Punctuation markers — run before structural. Trailing punctuation (which
# Whisper often adds reflexively when it hears the command) is consumed
# along with the word to avoid doubled punctuation like "stable..".
_PUNCTUATION_MARKERS: list[tuple[re.Pattern[str], str]] = [
    # " period" → "." — preceded by whitespace, optionally followed by
    # Whisper-inserted punctuation, then whitespace or end-of-text.
    (
        re.compile(r"\s+\bperiod\b[.!?,;:]*(?=\s|$)", re.IGNORECASE),
        ".",
    ),
    # " comma" → ","
    (
        re.compile(r"\s+\bcomma\b[.!?,;:]*(?=\s|$)", re.IGNORECASE),
        ",",
    ),
]


def apply_markers(text: str) -> str:
    """Substitute spoken dictation control phrases for the punctuation or
    formatting they describe.

    Pure function — does not consult settings or app context. Callers that
    want to honor the admin "dictation_markers_enabled" toggle should gate
    the call themselves (see routes/transcription.py).
    """
    if not text:
        return text
    for pattern, replacement in _PUNCTUATION_MARKERS:
        text = pattern.sub(replacement, text)
    for pattern, replacement in _STRUCTURAL_MARKERS:
        text = pattern.sub(replacement, text)
    return text
