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
import io
import os
import tempfile

from faster_whisper import WhisperModel
from pydub import AudioSegment

from app.services import settings as settings_service

_model = None
# Size of the currently-cached _model, so callers can report it and so a
# stale cache (setting changed without reload_model being called) is at
# least detectable.
_model_size: str | None = None


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
        _model_size = settings_service.get_whisper_model()
        _model = WhisperModel(_model_size, device="cpu", compute_type="int8")
    return _model


def reload_model() -> None:
    """Drop the cached model so the next get_model() reloads from the
    current `whisper_model` setting. Called after the admin installs and
    activates a different size."""
    global _model, _model_size
    _model = None
    _model_size = None


def loaded_model_size() -> str | None:
    """Size of the model currently held in memory, or None if not loaded."""
    return _model_size


# Demuxer hints we trust pydub/ffmpeg to receive. The filename is attacker-
# controlled, so we never pass through arbitrary extensions — values outside
# this set fall through to ffmpeg autodetection from the content itself.
_FORMAT_HINT_ALLOWLIST = {
    'wav', 'mp3', 'm4a', 'mp4', 'ogg', 'opus', 'webm', 'flac', 'aac',
}


def prepare_wav(file_storage) -> str:
    """Decode an upload to a temp WAV file and return the path. Caller owns deletion."""
    raw_ext = (file_storage.filename or '').rsplit('.', 1)[-1].lower() if file_storage.filename else ''
    src_format = raw_ext if raw_ext in _FORMAT_HINT_ALLOWLIST else None
    file_storage.seek(0)
    audio_bytes = file_storage.read()
    audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=src_format)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    audio.export(tmp.name, format="wav")
    tmp.close()
    return tmp.name


def transcribe_path_streaming(
    audio_path: str,
    language: str = "en",
    *,
    initial_prompt: str | None = None,
):
    """Generator variant of transcribe_path that yields progress events.

    Yields ``("progress", float_in_0_to_1)`` after each segment is decoded,
    and finally ``("result", (text, segments, words))`` once the audio has
    been consumed. Progress is computed against ``info.duration`` (the
    total audio length faster-whisper reports up front), so it stays
    honest even when VAD trims silence.
    """
    kwargs: dict = {"language": language, "word_timestamps": True}
    if initial_prompt:
        kwargs["initial_prompt"] = initial_prompt
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
