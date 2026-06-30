"""Merge a second recording's transcript onto an existing note's transcript.

Backs POST /api/notes/<id>/append-recording. A note's transcript is stored
three ways that must stay consistent (see models/note.py): the flat/diarized
`note_content_raw`, the diarized `note_content_segments`, and the per-word
`note_content_words`. Each recording's segment/word timestamps are absolute
*from the start of that recording*, and diarized speakers are numbered
"Speaker 1", "Speaker 2", ... per recording — so naively concatenating two
recordings would collide both timelines and both speaker spaces.

`merge_recording` resolves that: it offsets the incoming recording's timestamps
past the end of the existing one (one monotonic timeline) and renumbers the
incoming diarized speakers to continue after the existing ones (the user then
re-labels the new speakers in the diarized-transcript editor). It also tags
each turn with a `source` index (0 = original recording, 1 = first append, ...)
for display/ordering, and with the `audioFileId` of the clip it came from so
the UI can load and seek the exact recording (keyed by id, not by position).

The function is pure — it takes and returns plain data, touches no DB or
request state — so it is easy to unit-test and the route stays thin.
"""
import re

from app.services.diarization import segments_to_text

# Diarization labels are "Speaker N" (1-indexed). Matches diarization.merge_segments.
_SPEAKER_RE = re.compile(r"^Speaker (\d+)$")


def _as_list(value) -> list:
    return value if isinstance(value, list) else []


def _timeline_end(segments, words) -> float:
    """The largest `end` timestamp across a recording's segments and words.

    This is the point the appended recording is offset past so the merged
    transcript reads as one continuous timeline. Returns 0.0 when neither
    layer carries usable times (a flat, word-less note) — in which case the
    appended times simply start at 0 too, which is harmless: segment/word
    order is carried by list position, not by timestamp.
    """
    end = 0.0
    for item in _as_list(segments) + _as_list(words):
        if not isinstance(item, dict):
            continue
        try:
            end = max(end, float(item.get('end') or 0.0))
        except (TypeError, ValueError):
            continue
    return end


def _source_of(seg, default: int = 0) -> int:
    """The recording-source index stored on a segment (0 = original)."""
    try:
        return int(seg.get('source', default))
    except (TypeError, ValueError):
        return default


def _max_source(segments) -> int:
    """Highest source index across `segments`. 0 if none are tagged."""
    highest = 0
    for seg in _as_list(segments):
        if isinstance(seg, dict):
            highest = max(highest, _source_of(seg, 0))
    return highest


def _max_speaker_index(segments) -> int:
    """Highest N among "Speaker N" labels in `segments`. 0 if none/undiarized.

    "Unknown" and any non-conforming label are ignored, so the renumbered
    incoming speakers slot in right after the existing numbered ones.
    """
    highest = 0
    for seg in _as_list(segments):
        if not isinstance(seg, dict):
            continue
        m = _SPEAKER_RE.match(str(seg.get('speaker') or ''))
        if m:
            highest = max(highest, int(m.group(1)))
    return highest


def _offset_words(words, offset: float) -> list:
    """Shift every word's start/end by `offset`, preserving the other keys."""
    out = []
    for w in _as_list(words):
        if not isinstance(w, dict):
            continue
        shifted = dict(w)
        for k in ('start', 'end'):
            if k in shifted:
                try:
                    shifted[k] = float(shifted[k]) + offset
                except (TypeError, ValueError):
                    pass
        out.append(shifted)
    return out


def _shift_and_renumber_segments(segments, offset: float, base_speaker_count: int) -> list:
    """Offset incoming segment times and renumber their "Speaker N" labels.

    Distinct incoming speakers are mapped, in first-appearance order, to new
    labels continuing after `base_speaker_count` (so Speaker 1/2 in the new
    clip become Speaker 3/4 when the note already had two speakers). "Unknown"
    and None speakers pass through unchanged.
    """
    mapping: dict[str, str] = {}
    next_index = base_speaker_count
    out = []
    for seg in _as_list(segments):
        if not isinstance(seg, dict):
            continue
        speaker = seg.get('speaker')
        if isinstance(speaker, str) and _SPEAKER_RE.match(speaker):
            if speaker not in mapping:
                next_index += 1
                mapping[speaker] = f"Speaker {next_index}"
            speaker = mapping[speaker]
        try:
            start = float(seg.get('start') or 0.0) + offset
            end = float(seg.get('end') or 0.0) + offset
        except (TypeError, ValueError):
            start = end = offset
        if end < start:
            end = start
        out.append({
            "speaker": speaker,
            "start": start,
            "end": end,
            "text": (seg.get('text') or '').strip(),
        })
    return [s for s in out if s['text']]


def _join_flat(base: str, add: str) -> str:
    """Concatenate two flat transcripts with a blank line between them."""
    base = (base or '').rstrip()
    add = (add or '').strip()
    if not base:
        return add
    if not add:
        return base
    return f"{base}\n\n{add}"


def merge_recording(*, base_raw, base_segments, base_words, add_raw, add_segments,
                     add_words, add_audio_file_id=None) -> dict:
    """Merge an appended recording onto a note's existing transcript.

    Returns {"raw": str, "segments": list|None, "words": list|None} ready to
    assign onto the note. The merged note keeps the *existing* note's
    diarization mode:

    - Existing note diarized (has segments): the result stays diarized. An
      incoming diarized clip is offset + speaker-renumbered and appended; an
      incoming flat clip is wrapped as one "Unknown" turn so the structure
      survives. `raw` is rebuilt from the merged segments (segments_to_text),
      matching the invariant update_note_segments enforces.
    - Existing note flat (no segments): the result stays flat — any incoming
      segment structure is dropped and the raw texts are concatenated.

    Per-word confidence is carried only when *both* sides have a word list
    (otherwise the merged list can't be aligned to the merged text, so it is
    dropped — the same None state legacy/pasted notes already use).
    """
    offset = _timeline_end(base_segments, base_words)
    base_segs = _as_list(base_segments)

    if base_segs:
        # Tag every turn with the recording it came from (0 = the original
        # recording, 1 = the first append, ...). The frontend uses this to
        # show which clip a span of transcript belongs to. Existing turns keep
        # their source (defaulting to 0 for notes that predate this), and the
        # appended turns get the next index up.
        new_source = _max_source(base_segs) + 1
        if _as_list(add_segments):
            incoming = _shift_and_renumber_segments(
                add_segments, offset, _max_speaker_index(base_segs)
            )
        else:
            text = (add_raw or '').strip()
            incoming = (
                [{"speaker": "Unknown", "start": offset, "end": offset, "text": text}]
                if text else []
            )
        base_tagged = [{**s, "source": _source_of(s, 0)} for s in base_segs]
        # Stamp the appended turns with BOTH the ordinal source (for display +
        # offset) and the real audio_file_id of the clip they came from. The
        # frontend seeks by audioFileId, never by source position, so a missing
        # clip (audio storage off) is simply unseekable rather than misaligned.
        incoming = [
            {**s, "source": new_source, "audioFileId": add_audio_file_id}
            for s in incoming
        ]
        merged_segments = base_tagged + incoming
        merged_raw = segments_to_text(merged_segments)
    else:
        merged_segments = None
        merged_raw = _join_flat(base_raw, add_raw)

    if _as_list(base_words) and _as_list(add_words):
        merged_words = _as_list(base_words) + _offset_words(add_words, offset)
    else:
        merged_words = None

    return {"raw": merged_raw, "segments": merged_segments, "words": merged_words}
