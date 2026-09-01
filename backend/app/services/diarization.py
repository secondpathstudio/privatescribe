"""Speaker diarization via pyannote.audio.

Two ways the pyannote `speaker-diarization-3.1` pipeline is loaded, in order:

1. Bundled weights (the packaged app, and dev once `npm run build:pyannote`
   has run). `scripts/fetch-pyannote.mjs` stages the three MIT-licensed model
   repos under build-resources/pyannote/; the packaged app ships them at
   Resources/pyannote-models/ and the Electron shell points the backend at
   them via PYANNOTE_MODELS_DIR. Loading rewrites the pipeline config to
   reference the local weight files, so it needs no HF_TOKEN and no network.
2. HuggingFace download (fallback). With no bundled weights the pipeline is
   pulled from HuggingFace on first use — a gated model, so an admin must
   accept the user conditions on huggingface.co and set HF_TOKEN in
   backend/.env once.

Pipeline loading is lazy because it is slow (hundreds of MB of weights) and
because we don't want the whole backend to refuse to boot when diarization
isn't configured. The first /api/transcribe call with diarize=true will stall
for ~5–10s on cold load; subsequent calls reuse the cached pipeline.

Device placement: the loaded pipeline is moved onto the configured device
(mps / cuda / cpu). The configured value can be "auto" (the default) which
picks the fastest available — MPS on Apple Silicon, then CUDA, falling back
to CPU. Admins can override at runtime via /api/admin/settings/diarization-device;
on change the cached pipeline is moved to the new device with `pipeline.to()`
so subsequent calls use it without a full reload.
"""
import logging
import os
import re
import threading
from pathlib import Path
from typing import Optional

from app.paths import data_dir

logger = logging.getLogger(__name__)

# The pipeline repo and its two sub-model repos, as staged by
# scripts/fetch-pyannote.mjs into per-repo subfolders.
_PIPELINE_SUBDIR = "speaker-diarization-3.1"
_SEGMENTATION_SUBDIR = "segmentation-3.0"
_EMBEDDING_SUBDIR = "wespeaker-voxceleb-resnet34-LM"

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


def bundled_models_dir() -> Optional[Path]:
    """Return the directory holding the bundled pyannote model weights, or
    None when they have not been staged.

    Resolution order:
      1. PYANNOTE_MODELS_DIR — set by the Electron shell to the packaged
         Resources/pyannote-models/ folder.
      2. build-resources/pyannote/ in the repo — present once a developer has
         run `npm run build:pyannote`, so `flask run` gets token-free
         diarization too.
    A candidate counts only if the pipeline config is actually present.
    """
    candidates: list[Path] = []
    env = os.getenv("PYANNOTE_MODELS_DIR")
    if env:
        candidates.append(Path(env))
    # backend/app/services/diarization.py -> repo root is parents[3].
    candidates.append(Path(__file__).resolve().parents[3] / "build-resources" / "pyannote")
    for d in candidates:
        if (d / _PIPELINE_SUBDIR / "config.yaml").is_file():
            return d
    return None


def is_available() -> bool:
    """True when diarization can run: bundled weights are staged, or HF_TOKEN
    is set for the HuggingFace-download fallback. Used to gate the boot-time
    pre-warm so a backend without diarization configured doesn't log noise."""
    return bundled_models_dir() is not None or bool(os.getenv("HF_TOKEN"))


def _local_pipeline_config(models_dir: Path) -> Path:
    """Write a pipeline config.yaml whose segmentation/embedding sub-models
    point at the bundled weight files by absolute path, and return its path.

    pyannote's `Pipeline.from_pretrained` only reads a checkpoint id or a
    config file, so the local weights are wired in by rewriting the staged
    config. Absolute paths mean the written config works regardless of where
    it or the app bundle live. Regenerated on each load — it is a few hundred
    bytes — so a moved/reinstalled app always gets correct paths.
    """
    import yaml

    cfg = yaml.safe_load((models_dir / _PIPELINE_SUBDIR / "config.yaml").read_text())
    params = cfg["pipeline"]["params"]
    params["segmentation"] = str(models_dir / _SEGMENTATION_SUBDIR / "pytorch_model.bin")
    params["embedding"] = str(models_dir / _EMBEDDING_SUBDIR / "pytorch_model.bin")
    out = data_dir() / "pyannote-pipeline.yaml"
    out.write_text(yaml.safe_dump(cfg))
    return out


def _download_hub_models(token: str) -> Path:
    """Download the pipeline + sub-model repos and return a directory shaped
    exactly like the bundled staging dir, so the fallback rejoins the bundled
    code path (_local_pipeline_config → local file loads).

    Needed because huggingface_hub 1.x (pulled in by transformers for the
    MedASR engine) removed the `use_auth_token` kwarg that pyannote 3.x still
    passes on its own hub path — so we fetch the files ourselves with the
    modern `token=` API and never let pyannote touch the hub. Downloads are
    incremental: snapshot_download reuses already-fetched files, so this is a
    no-op after the first run.
    """
    from huggingface_hub import snapshot_download

    root = data_dir() / "pyannote-hub"
    for subdir, repo in (
        (_PIPELINE_SUBDIR, "pyannote/speaker-diarization-3.1"),
        (_SEGMENTATION_SUBDIR, "pyannote/segmentation-3.0"),
        (_EMBEDDING_SUBDIR, "pyannote/wespeaker-voxceleb-resnet34-LM"),
    ):
        snapshot_download(repo, token=token, local_dir=str(root / subdir))
    return root


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
        logger.info(f"Diarization pipeline moved to device: {target}")
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

        try:
            # Imported lazily so the rest of the backend can boot without torch installed
            # (e.g. in a stripped-down deploy that doesn't use diarization).
            from pyannote.audio import Pipeline
        except ImportError as e:
            raise DiarizationUnavailable(
                "pyannote.audio is not installed. Run `pip install -r requirements.txt`."
            ) from e

        # Prefer the bundled weights — no token, no network. Fall back to a
        # HuggingFace download (gated, needs HF_TOKEN) only when nothing is
        # staged. Either way the pipeline is loaded from LOCAL files: pyannote
        # 3.x's own hub path passes the `use_auth_token` kwarg that
        # huggingface_hub 1.x removed, so it must never fetch for itself.
        models_dir = bundled_models_dir()
        if models_dir is not None:
            logger.info(f"Loading bundled diarization pipeline from {models_dir}")
        else:
            token = os.getenv("HF_TOKEN")
            if not token:
                raise DiarizationUnavailable(
                    "Speaker identification is unavailable: no bundled pyannote models were "
                    "found and HF_TOKEN is not set. Stage the models with `npm run "
                    "build:pyannote`, or add HF_TOKEN=hf_... to backend/.env and accept the "
                    "user conditions for `pyannote/speaker-diarization-3.1` on huggingface.co."
                )
            try:
                models_dir = _download_hub_models(token)
            except Exception as e:
                raise DiarizationUnavailable(
                    f"Could not download pyannote models: {type(e).__name__}: {e}. "
                    "Verify HF_TOKEN is valid and that you've accepted the user "
                    "conditions for pyannote/speaker-diarization-3.1, "
                    "pyannote/segmentation-3.0, and "
                    "pyannote/wespeaker-voxceleb-resnet34-LM on huggingface.co."
                ) from e
        checkpoint = _local_pipeline_config(models_dir)

        try:
            pipeline = Pipeline.from_pretrained(checkpoint)
        except ModuleNotFoundError as e:
            # pyannote pulls in some transitive deps lazily (matplotlib via pyannote.metrics,
            # for example). Surface this distinctly from auth/network failures.
            raise DiarizationUnavailable(
                f"Missing dependency while loading pyannote pipeline: {e}. "
                "Run `pip install -r requirements.txt` to install it."
            ) from e
        except Exception as e:
            # Loading is always from local files now (bundled or freshly
            # downloaded above), so a failure here means missing/corrupt files.
            raise DiarizationUnavailable(
                f"Could not load pyannote pipeline: {type(e).__name__}: {e}. "
                "The local pyannote model files may be missing or corrupt; re-stage "
                "them with `npm run build:pyannote` or delete the data dir's "
                "pyannote-hub folder to re-download."
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
                    logger.warning(
                        f"Diarization pipeline failed to load on {target}: {type(e).__name__}: {e}. "
                        f"Falling back to CPU."
                    )
                    pipeline.to(torch.device("cpu"))
                    target = "cpu"
                else:
                    raise

        _effective_device = target
        _pipeline = pipeline
        logger.info(f"Diarization pipeline loaded on device: {target}")
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
