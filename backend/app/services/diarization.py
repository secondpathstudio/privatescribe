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

Device placement: the loaded pipeline is moved onto the configured device
(mps / cuda / cpu). The configured value can be "auto" (the default) which
picks the fastest available — MPS on Apple Silicon, then CUDA, falling back
to CPU. Admins can override at runtime via /api/admin/settings/diarization-device;
on change the cached pipeline is moved to the new device with `pipeline.to()`
so subsequent calls use it without a full reload.
"""
import os
import re
import threading
from typing import Optional

# In-memory state. Mutated by configure_device() / get_pipeline(). Holding the
# lock around mutations keeps concurrent /api/transcribe and admin-PUT calls
# from racing on pipeline loading or device moves.
_lock = threading.Lock()
_pipeline = None
_configured_device: str = "auto"  # admin's choice; "auto" or a concrete device
_effective_device: Optional[str] = None  # device the loaded pipeline is on; None until loaded

VALID_DEVICES = ("auto", "mps", "cuda", "cpu")


class DiarizationUnavailable(RuntimeError):
    """Raised when the pyannote pipeline cannot be loaded (missing token, no network on first run, etc.)."""


def _detect_torch():
    """Import torch lazily so the rest of the backend can boot without it."""
    try:
        import torch
        return torch
    except ImportError:
        return None


def available_devices() -> list[str]:
    """Return the concrete devices this machine can run pyannote on, in
    preferred order. Always includes 'cpu'. 'mps' / 'cuda' appear only if
    torch reports them available."""
    torch = _detect_torch()
    devices = []
    if torch is not None:
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            devices.append("mps")
        if torch.cuda.is_available():
            devices.append("cuda")
    devices.append("cpu")
    return devices


def _resolve_device(name: str) -> str:
    """Map 'auto' to the best available concrete device. Concrete names are
    returned as-is even if torch reports them unavailable — caller will see
    the failure on `.to()` and can fall back."""
    if name == "auto":
        return available_devices()[0]
    return name


def configured_device() -> str:
    """Return the admin-configured device name (one of VALID_DEVICES)."""
    return _configured_device


def effective_device() -> Optional[str]:
    """Return the concrete device the loaded pipeline is on, or None if the
    pipeline hasn't been loaded yet."""
    return _effective_device


def set_configured_device(name: str) -> str:
    """Update the configured device. If the pipeline is already loaded, move
    it onto the new device. Returns the resolved effective device.

    Raises ValueError for unknown device names. If the pipeline is loaded and
    the move fails, the configured device is still updated (so the next load
    tries it fresh) but the exception is re-raised so the admin sees what
    happened.
    """
    if name not in VALID_DEVICES:
        raise ValueError(f"unknown device {name!r}; must be one of {VALID_DEVICES}")

    global _configured_device, _effective_device
    with _lock:
        _configured_device = name
        if _pipeline is None:
            # Not loaded yet — next get_pipeline() call will use the new
            # configured device.
            return _resolve_device(name)

        target = _resolve_device(name)
        torch = _detect_torch()
        if torch is None:
            # Pipeline is loaded but torch import failed somehow (shouldn't
            # happen — pyannote pulls torch in). Leave as-is.
            return _effective_device or "cpu"

        _pipeline.to(torch.device(target))
        _effective_device = target
        print(f"Diarization pipeline moved to device: {target}")
        return target


def get_pipeline():
    """Lazily load the pyannote speaker-diarization pipeline. Raises DiarizationUnavailable on failure."""
    global _pipeline, _effective_device
    if _pipeline is not None:
        return _pipeline

    with _lock:
        # Re-check inside the lock so two threads racing in don't both load.
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
            pipeline = Pipeline.from_pretrained(
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

        # Move pipeline onto the configured device. If MPS is configured but
        # the move fails (e.g. unsupported op at .to() time), fall back to CPU
        # so the user gets working diarization rather than a cryptic error.
        target = _resolve_device(_configured_device)
        torch = _detect_torch()
        if torch is not None:
            try:
                pipeline.to(torch.device(target))
            except Exception as e:
                if target != "cpu":
                    print(
                        f"Diarization pipeline failed to load on {target}: {type(e).__name__}: {e}. "
                        f"Falling back to CPU."
                    )
                    pipeline.to(torch.device("cpu"))
                    target = "cpu"
                else:
                    raise

        _effective_device = target
        _pipeline = pipeline
        print(f"Diarization pipeline loaded on device: {target}")
        return _pipeline


def diarize_path(
    audio_path: str,
    num_speakers: Optional[int] = None,
    max_speakers: Optional[int] = None,
) -> list[dict]:
    """Run diarization on a WAV file. Returns [{start, end, speaker}, ...] in time order.

    `speaker` is the raw pyannote label (e.g. SPEAKER_00); merge_segments() relabels
    them into user-friendly Speaker N strings.

    `num_speakers` forces an exact count (use only if certain — being wrong
    creates phantom speakers or merges real ones). `max_speakers` is a softer
    upper bound; pyannote can still settle on fewer if it detects fewer.
    Prefer `max_speakers` when the count comes from a participant list since
    not everyone listed necessarily spoke.
    """
    pipeline = get_pipeline()
    kwargs = {}
    if num_speakers is not None:
        kwargs["num_speakers"] = num_speakers
    elif max_speakers is not None:
        # pyannote requires min_speakers when max_speakers is set; 1 is the
        # natural floor (at least one person spoke if there's any audio).
        kwargs["min_speakers"] = 1
        kwargs["max_speakers"] = max_speakers
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


def relabel_speakers(text: Optional[str], speaker_labels: Optional[dict]) -> Optional[str]:
    """Rewrite raw "Speaker N" labels in `text` with their assigned names.

    `speaker_labels` is the Note.speaker_labels overlay produced by the manual
    speaker-naming UI: {"Speaker 1": {"participantId": ..., "name": "Dr. Smith"},
    ...}. Whole-word matching means it rewrites both the line prefixes that
    segments_to_text() emits ("Speaker 1: ...") and any inline "Speaker 1"
    mentions in LLM-formatted output. Returns `text` unchanged when there are
    no labels — callers can pass the value straight through.

    Used so that the LLM formatting pass and the PDF/DOCX exports speak the
    participants' real names rather than the anonymous diarization labels.
    """
    if not text or not speaker_labels:
        return text
    # Replace longer labels first so "Speaker 1" can't shadow "Speaker 10".
    # The \b after the label already blocks that overlap, but ordering keeps
    # the behavior obvious and robust if the label format ever changes.
    for raw in sorted(speaker_labels, key=len, reverse=True):
        entry = speaker_labels.get(raw) or {}
        name = (entry.get('name') or '').strip()
        if not name:
            continue
        # Function replacement so backslashes/group refs in `name` are literal.
        text = re.sub(rf"\b{re.escape(raw)}\b", lambda _m, n=name: n, text)
    return text
