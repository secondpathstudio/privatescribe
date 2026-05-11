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
