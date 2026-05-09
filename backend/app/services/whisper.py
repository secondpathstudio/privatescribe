"""Faster-Whisper transcription service.

The model is loaded lazily on first use and cached process-wide. Loading it
is slow (hundreds of MB of weights), so create_app() can call get_model()
during boot to warm the cache and avoid a stall on the first /api/transcribe.
"""
import io

from faster_whisper import WhisperModel
from pydub import AudioSegment

_model = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel("base", device="cpu", compute_type="int8")
    return _model


def _convert_to_wav(audio_data: bytes, src_format: str) -> io.BytesIO:
    """Re-encode non-WAV audio via pydub/ffmpeg into an in-memory WAV."""
    audio = AudioSegment.from_file(io.BytesIO(audio_data), format=src_format)
    wav_io = io.BytesIO()
    audio.export(wav_io, format="wav")
    wav_io.seek(0)
    return wav_io


def transcribe_file(file_storage, language: str = "en") -> str:
    """Transcribe a Werkzeug FileStorage uploaded via multipart and return the
    concatenated text of all segments."""
    src_format = file_storage.filename.split('.')[-1]
    file_storage.seek(0)
    audio_bytes = file_storage.read()

    if src_format.lower() != "wav":
        audio_io = _convert_to_wav(audio_bytes, src_format)
    else:
        audio_io = io.BytesIO(audio_bytes)

    segments, _info = get_model().transcribe(audio_io, language=language)
    return " ".join(s.text for s in segments)
