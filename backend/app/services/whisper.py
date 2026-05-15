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


def transcribe_path(
    audio_path: str,
    language: str = "en",
    *,
    initial_prompt: str | None = None,
) -> tuple[str, list[dict], list[dict]]:
    """Transcribe a WAV path and return ``(text, segments, words)``.

    - ``text`` is the concatenated transcript.
    - ``segments`` is the per-segment list ``[{start, end, text}, ...]``
      used by the diarization merge.
    - ``words`` is a flat per-word list ``[{word, probability, start, end}]``
      across all segments. Powers confidence highlighting in the UI; safe
      to ignore for callers that don't care.

    ``initial_prompt`` is forwarded to Faster-Whisper as a recognition hint
    — typically a comma-separated vocabulary list of domain terms. None
    skips the kwarg entirely so we don't perturb decoding for callers that
    don't care.

    Word-level timestamps come at a small CPU cost (~10-15%) and the
    decoder produces them once per token regardless of whether the caller
    consumes them, so it's worth always asking for them and discarding when
    unused.
    """
    kwargs: dict = {"language": language, "word_timestamps": True}
    if initial_prompt:
        kwargs["initial_prompt"] = initial_prompt
    segments, _info = get_model().transcribe(audio_path, **kwargs)
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
    return " ".join(parts), out_segments, out_words


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
