"""Speaker diarization via pyannote.audio.

The pretrained pipeline `pyannote/speaker-diarization-3.1` is downloaded from
HuggingFace on first use into ~/.cache/huggingface/. It is a gated model: the
admin must accept the user conditions on huggingface.co and set HF_TOKEN in
backend/.env once. After the first download everything runs offline — set
HF_HUB_OFFLINE=1 if you want to be sure.

Pipeline loading is lazy because it is slow (hundreds of MB of weights) and
because we don't want the whole backend to refuse to boot just because HF_TOKEN
isn't configured. The first /api/transcribe call with diarize=true will stall
for ~5–10s on cold load; subsequent calls reuse the cached pipeline.
"""
import os
from typing import Optional

_pipeline = None


class DiarizationUnavailable(RuntimeError):
    """Raised when the pyannote pipeline cannot be loaded (missing token, no network on first run, etc.)."""


def get_pipeline():
    """Lazily load the pyannote speaker-diarization pipeline. Raises DiarizationUnavailable on failure."""
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    token = os.getenv("HF_TOKEN")
    if not token:
        raise DiarizationUnavailable(
            "HF_TOKEN is not set. Add HF_TOKEN=hf_... to backend/.env and accept the user "
            "conditions for `pyannote/speaker-diarization-3.1` on huggingface.co."
        )

    try:
        # Imported lazily so the rest of the backend can boot without torch installed
        # (e.g. in a stripped-down deploy that doesn't use diarization).
        from pyannote.audio import Pipeline
    except ImportError as e:
        raise DiarizationUnavailable(
            "pyannote.audio is not installed. Run `pip install -r requirements.txt`."
        ) from e

    try:
        _pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=token,
        )
    except ModuleNotFoundError as e:
        # pyannote pulls in some transitive deps lazily (matplotlib via pyannote.metrics,
        # for example). Surface this distinctly from auth/network failures.
        raise DiarizationUnavailable(
            f"Missing dependency while loading pyannote pipeline: {e}. "
            "Run `pip install -r requirements.txt` to install it."
        ) from e
    except Exception as e:
        raise DiarizationUnavailable(
            f"Could not load pyannote pipeline: {type(e).__name__}: {e}. "
            "Verify HF_TOKEN is valid and that you've accepted the model's user conditions."
        ) from e

    return _pipeline


def diarize_path(audio_path: str, num_speakers: Optional[int] = None) -> list[dict]:
    """Run diarization on a WAV file. Returns [{start, end, speaker}, ...] in time order.

    `speaker` is the raw pyannote label (e.g. SPEAKER_00); merge_segments() relabels
    them into user-friendly Speaker N strings.
    """
    pipeline = get_pipeline()
    kwargs = {}
    if num_speakers is not None:
        kwargs["num_speakers"] = num_speakers
    annotation = pipeline(audio_path, **kwargs)

    turns = []
    for segment, _, label in annotation.itertracks(yield_label=True):
        turns.append({
            "start": float(segment.start),
            "end": float(segment.end),
            "speaker": label,
        })
    return turns


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def merge_segments(whisper_segments: list[dict], diar_turns: list[dict]) -> list[dict]:
    """Assign a speaker to each Whisper segment by max temporal overlap, then collapse
    consecutive same-speaker segments into single turns.

    Returns [{speaker, start, end, text}, ...] with speakers relabeled as
    "Speaker 1", "Speaker 2", ... in order of first appearance.
    """
    if not whisper_segments:
        return []

    label_map: dict[str, str] = {}

    def friendly(raw_label: str) -> str:
        if raw_label not in label_map:
            label_map[raw_label] = f"Speaker {len(label_map) + 1}"
        return label_map[raw_label]

    # Tag each whisper segment with its best-overlap speaker (or Unknown if no diarization
    # turn covers it — happens for very short utterances or silence-bracketed words).
    tagged = []
    for ws in whisper_segments:
        best_speaker = None
        best_overlap = 0.0
        for turn in diar_turns:
            o = _overlap(ws["start"], ws["end"], turn["start"], turn["end"])
            if o > best_overlap:
                best_overlap = o
                best_speaker = turn["speaker"]
        speaker = friendly(best_speaker) if best_speaker is not None else "Unknown"
        tagged.append({
            "speaker": speaker,
            "start": ws["start"],
            "end": ws["end"],
            "text": ws["text"],
        })

    # Collapse runs of the same speaker into a single turn.
    merged: list[dict] = []
    for seg in tagged:
        if merged and merged[-1]["speaker"] == seg["speaker"]:
            merged[-1]["end"] = seg["end"]
            merged[-1]["text"] = (merged[-1]["text"] + " " + seg["text"].strip()).strip()
        else:
            merged.append({
                "speaker": seg["speaker"],
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"].strip(),
            })
    return merged


def segments_to_text(merged_segments: list[dict]) -> str:
    """Render merged speaker segments as `Speaker 1: ...\\nSpeaker 2: ...` for storage and display."""
    return "\n".join(f"{seg['speaker']}: {seg['text']}" for seg in merged_segments)
