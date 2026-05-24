"""Faster-Whisper transcription service.

The model is loaded lazily on first use and cached process-wide. Loading it
is slow (hundreds of MB of weights), so create_app() can call get_model()
during boot to warm the cache and avoid a stall on the first /api/transcribe.

Which model size loads is admin-configurable via the `whisper_model` system
setting (default "base"). Admins switch it from the Transcription settings
page, which downloads the weights first — see services/whisper_manager.py.
When the admin changes the setting, the route calls reload_model() to drop
the cached instance so the next get_model() picks up the new size.

Audio is decoded to a temp WAV file once so both Whisper and pyannote
diarization can read it without re-decoding.
"""
import os
import subprocess
import tempfile
import threading

from faster_whisper import BatchedInferencePipeline, WhisperModel
from pydub import AudioSegment

from app.services import settings as settings_service

_model = None
# Size of the currently-cached _model, so callers can report it and so a
# stale cache (setting changed without reload_model being called) is at
# least detectable.
_model_size: str | None = None
# BatchedInferencePipeline wrapping _model, built lazily on first batched
# transcription. It VAD-chunks the audio and runs the chunks through the
# encoder in batches — ~2-4x faster on a whole file than the sequential
# path. We only use it for file uploads; live 2s ticks stay on the plain
# model (batching a single short chunk buys nothing and adds latency).
_batched_model: BatchedInferencePipeline | None = None
# Serializes first-use model construction. The packaged backend serves on
# waitress with 8 threads, so without this two concurrent transcribe requests
# (e.g. a live tick and a batch upload) would both enter the constructor on a
# fresh install and race on the same HuggingFace download — corrupting the
# cache and 500ing. Double-checked below so the steady-state path stays lock-free.
_model_lock = threading.Lock()


def get_model() -> WhisperModel:
    """Return the cached WhisperModel, loading it on first use.

    The size comes from the `whisper_model` setting. The admin flow only
    ever points that setting at an already-downloaded model, so this load
    is offline-safe; if a hand-edited setting names an uninstalled model,
    faster-whisper would try to fetch it — acceptable since that's an
    operator error, not a normal path.
    """
    global _model, _model_size
    if _model is None:
        with _model_lock:
            # Re-check inside the lock: another thread may have finished the
            # load while we were waiting to acquire it.
            if _model is None:
                size = settings_service.get_whisper_model()
                model = WhisperModel(size, device="cpu", compute_type="int8")
                _model_size = size
                _model = model
    return _model


def get_batched_model() -> BatchedInferencePipeline:
    """Return the cached BatchedInferencePipeline, building it on first use.

    The pipeline wraps the same underlying WhisperModel as get_model(), so it
    inherits the admin-selected size and adds no extra weights in memory.
    """
    global _batched_model
    if _batched_model is None:
        # Resolve the model *outside* the lock — get_model() takes _model_lock
        # itself, and threading.Lock is not reentrant, so acquiring it here
        # first would deadlock.
        model = get_model()
        with _model_lock:
            if _batched_model is None:
                _batched_model = BatchedInferencePipeline(model=model)
    return _batched_model


def reload_model() -> None:
    """Drop the cached model so the next get_model() reloads from the
    current `whisper_model` setting. Called after the admin installs and
    activates a different size."""
    global _model, _model_size, _batched_model
    _model = None
    _model_size = None
    # Drop the batched wrapper too — it holds a reference to the old model.
    _batched_model = None


def loaded_model_size() -> str | None:
    """Size of the model currently held in memory, or None if not loaded."""
    return _model_size


# Hard ceiling on the ffmpeg transcode. A real upload transcodes far faster
# than realtime; this only trips on a pathological or crafted file, turning a
# potential hang into a clean error.
_FFMPEG_TIMEOUT_SECONDS = 600


def prepare_wav(file_storage) -> str:
    """Decode an upload to a temp WAV file and return the path. Caller owns deletion.

    The upload is streamed to a temp file and transcoded by a direct ffmpeg
    subprocess, so neither the compressed upload nor the decoded audio is ever
    held whole in this process's memory — a large (or maliciously large)
    upload can't OOM the backend. Output is 16 kHz mono, which is what both
    Whisper and pyannote consume anyway.
    """
    src_fd, src_path = tempfile.mkstemp(suffix=".upload")
    os.close(src_fd)
    try:
        # Stream the upload to disk via FileStorage.save (a bounded-buffer
        # copy) rather than reading the whole thing into memory.
        file_storage.seek(0)
        file_storage.save(src_path)

        wav_fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(wav_fd)
        try:
            _transcode_to_wav(src_path, wav_path)
        except Exception:
            try:
                os.unlink(wav_path)
            except OSError:
                pass
            raise
        return wav_path
    finally:
        try:
            os.unlink(src_path)
        except OSError:
            pass


def _transcode_to_wav(src_path: str, wav_path: str) -> None:
    """Transcode any audio file to 16 kHz mono WAV via a direct ffmpeg call.

    ffmpeg streams the decode, so nothing large lands in this process's
    memory. The input format is auto-detected from the content — no
    attacker-controlled format hint is passed to ffmpeg, and the call uses no
    shell, so the attacker-influenced filename never reaches a command.
    """
    cmd = [
        AudioSegment.converter,  # the ffmpeg binary pydub resolved
        "-nostdin",
        "-loglevel", "error",
        "-y",
        "-i", src_path,
        "-vn",            # drop any video stream
        "-ac", "1",       # mono
        "-ar", "16000",   # 16 kHz — Whisper's and pyannote's working rate
        "-f", "wav",
        wav_path,
    ]
    try:
        proc = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=_FFMPEG_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            "Audio decoding timed out — the file is too large or malformed."
        )
    if proc.returncode != 0:
        lines = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        detail = lines[-1] if lines else f"ffmpeg exited {proc.returncode}"
        raise RuntimeError(f"Could not decode the uploaded audio: {detail}")


# Chunks decoded per encoder batch in batched mode. Kept modest so the win
# holds on a CPU-only box (the documented baseline) without ballooning memory.
_DEFAULT_BATCH_SIZE = 8


def transcribe_path_streaming(
    audio_path: str,
    language: str = "en",
    *,
    initial_prompt: str | None = None,
    batched: bool = False,
    batch_size: int = _DEFAULT_BATCH_SIZE,
):
    """Generator variant of transcribe_path that yields progress events.

    Yields ``("progress", float_in_0_to_1)`` after each segment is decoded,
    and finally ``("result", (text, segments, words))`` once the audio has
    been consumed. Progress is computed against ``info.duration`` (the
    total audio length faster-whisper reports up front), so it stays
    honest even when VAD trims silence.

    Set ``batched=True`` to run through the BatchedInferencePipeline (~2-4x
    faster on a whole file). Reserve it for complete uploads — it VAD-chunks
    and batches, which is pure overhead for a single short live tick. The
    yielded shape is identical either way, so callers don't branch.
    """
    kwargs: dict = {"language": language, "word_timestamps": True}
    if initial_prompt:
        kwargs["initial_prompt"] = initial_prompt
    if batched:
        segments, info = get_batched_model().transcribe(
            audio_path, batch_size=batch_size, **kwargs
        )
    else:
        segments, info = get_model().transcribe(audio_path, **kwargs)
    total_duration = float(getattr(info, "duration", 0) or 0)

    out_segments: list[dict] = []
    out_words: list[dict] = []
    parts: list[str] = []
    for s in segments:
        out_segments.append({"start": float(s.start), "end": float(s.end), "text": s.text})
        parts.append(s.text)
        # `s.words` is a list[Word] with .start/.end/.word/.probability
        # when word_timestamps=True. It can be None if the segment was
        # empty, so guard accordingly.
        for w in (s.words or []):
            out_words.append({
                "word": w.word,
                "probability": float(w.probability),
                "start": float(w.start),
                "end": float(w.end),
            })
        if total_duration > 0:
            yield "progress", min(1.0, float(s.end) / total_duration)
    yield "result", (" ".join(parts), out_segments, out_words)


def transcribe_path(
    audio_path: str,
    language: str = "en",
    *,
    initial_prompt: str | None = None,
) -> tuple[str, list[dict], list[dict]]:
    """Transcribe a WAV path and return ``(text, segments, words)``.

    Back-compat wrapper around transcribe_path_streaming for callers that
    don't care about progress (CLI script, transcribe_file helper). The
    streaming variant is the source of truth.
    """
    result: tuple[str, list[dict], list[dict]] | None = None
    for kind, payload in transcribe_path_streaming(
        audio_path, language, initial_prompt=initial_prompt
    ):
        if kind == "result":
            result = payload  # type: ignore[assignment]
    assert result is not None, "transcribe_path_streaming did not yield a result"
    return result


def transcribe_file(file_storage, language: str = "en") -> str:
    """Back-compat helper for callers that only need the flat transcript text."""
    path = prepare_wav(file_storage)
    try:
        text, _segments, _words = transcribe_path(path, language=language)
        return text
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
