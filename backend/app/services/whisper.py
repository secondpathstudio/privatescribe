"""Faster-Whisper transcription service.

The model is loaded lazily on first use and cached process-wide. Loading it
is slow (hundreds of MB of weights), so create_app() can call get_model()
during boot to warm the cache and avoid a stall on the first /api/transcribe.

Audio is decoded to a temp WAV file once so both Whisper and pyannote
diarization can read it without re-decoding.
"""
import io
import os
import tempfile

from faster_whisper import WhisperModel
from pydub import AudioSegment

_model = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel("base", device="cpu", compute_type="int8")
    return _model


def prepare_wav(file_storage) -> str:
    """Decode an upload to a temp WAV file and return the path. Caller owns deletion."""
    src_format = file_storage.filename.split('.')[-1].lower()
    file_storage.seek(0)
    audio_bytes = file_storage.read()
    audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=src_format)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    audio.export(tmp.name, format="wav")
    tmp.close()
    return tmp.name


def transcribe_path(audio_path: str, language: str = "en") -> tuple[str, list[dict]]:
    """Transcribe a WAV path and return (concatenated_text, [{start, end, text}, ...])."""
    segments, _info = get_model().transcribe(audio_path, language=language)
    out = []
    parts = []
    for s in segments:
        out.append({"start": float(s.start), "end": float(s.end), "text": s.text})
        parts.append(s.text)
    return " ".join(parts), out


def transcribe_file(file_storage, language: str = "en") -> str:
    """Back-compat helper for callers that only need the flat transcript text."""
    path = prepare_wav(file_storage)
    try:
        text, _ = transcribe_path(path, language=language)
        return text
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
