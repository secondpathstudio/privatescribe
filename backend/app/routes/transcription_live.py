"""Live (batched-window) transcription.

The browser records via MediaRecorder.start(2000) and, on every 2s timeslice,
POSTs the *full accumulated recording so far* to /api/transcribe/live. The
server overwrites the per-session webm file with that upload, re-transcribes
(and optionally diarizes) the trailing 30s of audio, and returns committed +
interim segments. The final authoritative transcript is still produced by the
existing /api/transcribe endpoint on stop.

Why the client re-sends the whole blob each tick rather than just the new
tail: only the first MediaRecorder chunk carries the webm/EBML header, so a
tail-only upload is headerless data ffmpeg rejects with "Invalid data found".
Posting the complete blob makes every request a self-contained, valid webm,
so a transient failure on one tick never poisons the rest of the session —
the next tick simply re-sends and recovers. Over loopback the re-upload is
cheap, and the server already re-decodes the whole window each tick anyway.

This is intentionally separate from /api/transcribe so the live preview is
best-effort and additive: failures here don't affect the final transcript.

Session storage: per-session webm files live in tempfile.gettempdir(). They
are NOT routed through audio_storage's encrypted-at-rest scheme. The live
file is short-lived (deleted on /finalize or after 10 min idle) and is a
subset of audio the user is about to upload through the normal encrypted path
anyway. The final-on-stop pass through /api/transcribe is what gets encrypted.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from pydub import AudioSegment

from app.extensions import db
from app.services.audit import log_action
from app.services.diarization import (
    DiarizationUnavailable,
    diarize_path,
    merge_segments,
)
from app.services.ffmpeg import get_ffmpeg
from app.services.whisper import transcribe_path

logger = logging.getLogger(__name__)

bp = Blueprint("transcription_live", __name__)


WINDOW_SECONDS = 30.0
COMMIT_CUTOFF_SECONDS = 20.0  # absolute end-time cutoff = total_duration - this
SESSION_TTL_SECONDS = 600

# Cap the on-disk size of a single live session's webm. Live transcription is
# a best-effort preview of audio about to be uploaded for real through
# /api/transcribe; it needn't support arbitrarily long recordings, and
# _decode_and_slice re-decodes the whole file each tick so very long sessions
# are impractical regardless. ~100 MB is well over an hour of voice webm.
MAX_SESSION_BYTES = 100 * 1024 * 1024

# Caps on concurrent live sessions. Each holds a tempfile, so without a ceiling
# a client (or a stolen token) could open sessions until the disk fills.
# Expired sessions are swept before these are checked, so they only reject
# when this many sessions are genuinely live.
MAX_ACTIVE_SESSIONS = 24
MAX_SESSIONS_PER_USER = 3


class SessionSizeExceeded(Exception):
    """Raised by _write_session_audio when the uploaded recording is larger
    than MAX_SESSION_BYTES."""


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


@dataclass
class _LiveSession:
    user_id: str
    audio_path: str
    committed_segments: list[dict] = field(default_factory=list)
    # Monotonic counter for session-stable "Speaker N" labels. Incremented
    # only when we see a per-call label with no temporal overlap to any
    # already-committed segment.
    next_speaker_id: int = 0
    last_touched: float = field(default_factory=time.time)
    lock: threading.Lock = field(default_factory=threading.Lock)


# Module-level registry. Concurrent ticks for the same session serialize on
# the session's own lock so a slow whisper call for user A doesn't stall
# user B's live tick.
_sessions: dict[str, _LiveSession] = {}
_registry_lock = threading.Lock()


def _cleanup_expired_locked() -> None:
    """Drop sessions idle for more than SESSION_TTL_SECONDS. Caller holds
    _registry_lock."""
    now = time.time()
    expired = [
        sid for sid, sess in _sessions.items()
        if now - sess.last_touched > SESSION_TTL_SECONDS
    ]
    for sid in expired:
        sess = _sessions.pop(sid, None)
        if sess is not None:
            try:
                os.unlink(sess.audio_path)
            except OSError:
                pass


def cleanup_stale_session_files() -> int:
    """Delete leftover live-session temp files from previous runs.

    Called once at startup (from create_app). The in-memory _sessions registry
    doesn't survive a process restart, so any ps_live_* file in the temp dir
    at boot is an orphan from a crashed or stopped run. Returns the count.
    """
    removed = 0
    tmp = tempfile.gettempdir()
    try:
        names = os.listdir(tmp)
    except OSError:
        return 0
    for name in names:
        if not name.startswith("ps_live_"):
            continue
        try:
            os.unlink(os.path.join(tmp, name))
            removed += 1
        except OSError:
            pass
    if removed:
        logger.info(f"transcription_live: cleared {removed} stale session file(s) on boot")
    return removed


def _new_session_locked(user_id: str) -> tuple[str, _LiveSession]:
    """Allocate a new session. Caller holds _registry_lock."""
    session_id = str(uuid.uuid4())
    fd, path = tempfile.mkstemp(prefix=f"ps_live_{session_id}_", suffix=".webm")
    os.close(fd)
    sess = _LiveSession(user_id=user_id, audio_path=path)
    _sessions[session_id] = sess
    return session_id, sess


def _write_session_audio(audio_path: str, upload_file) -> None:
    """Overwrite the session's webm file with the uploaded recording.

    The client posts the full accumulated recording each tick (only the first
    webm chunk carries the header), so each upload is a complete, self-contained
    webm and we replace the file wholesale rather than appending a tail.

    Raises SessionSizeExceeded — before writing anything — when the upload is
    larger than MAX_SESSION_BYTES, so the file is never written beyond the cap.
    The save streams to disk, so the recording is never held whole in memory.
    """
    upload_file.seek(0, os.SEEK_END)
    incoming = upload_file.tell()
    upload_file.seek(0)
    if incoming > MAX_SESSION_BYTES:
        raise SessionSizeExceeded(
            f"live session recording would exceed {MAX_SESSION_BYTES} bytes"
        )
    upload_file.save(audio_path)


def _webm_to_wav(src_path: str) -> str:
    """Transcode the session's growing webm to a temp 16 kHz mono WAV.

    Returns the wav path; the caller owns its deletion.

    We deliberately do NOT decode the webm with ``AudioSegment.from_file()``:
    for a non-wav input pydub shells out to ``ffprobe`` for stream info, and
    the packaged desktop app bundles only ``ffmpeg`` (via the imageio-ffmpeg
    wheel), not ``ffprobe``. There, ``from_file(webm)`` raises
    ``FileNotFoundError`` and the live tick 500s — which is the bug this
    function exists to avoid. A direct ffmpeg subprocess needs no ffprobe,
    and loading the resulting ``.wav`` afterwards takes pydub's ffprobe-free
    ``_from_safe_wav`` fast path. This mirrors ``whisper._transcode_to_wav``.
    """
    ffmpeg_bin = get_ffmpeg() or AudioSegment.converter
    wav_fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(wav_fd)
    cmd = [
        ffmpeg_bin,
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
            timeout=120,
        )
    except Exception:
        try:
            os.unlink(wav_path)
        except OSError:
            pass
        raise
    if proc.returncode != 0:
        try:
            os.unlink(wav_path)
        except OSError:
            pass
        lines = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        detail = lines[-1] if lines else f"ffmpeg exited {proc.returncode}"
        raise RuntimeError(f"Could not decode the live audio: {detail}")
    return wav_path


def _decode_and_slice(audio_path: str) -> tuple[str, float, float]:
    """Decode the growing webm to a temp WAV containing the last WINDOW_SECONDS.

    Returns (wav_path, window_start_absolute, total_duration). Caller owns
    deletion of the returned wav_path.

    The cost of this scales with total session length because the whole webm
    is re-decoded each tick — acceptable for typical session lengths
    (a few minutes). If long sessions become common, switch to a long-running
    ffmpeg subprocess that streams PCM into a growing WAV.
    """
    full_wav = _webm_to_wav(audio_path)
    try:
        # from_wav takes pydub's wave-module fast path — no ffprobe call.
        audio = AudioSegment.from_wav(full_wav)
    finally:
        try:
            os.unlink(full_wav)
        except OSError:
            pass

    total_ms = len(audio)
    total_duration = total_ms / 1000.0
    window_ms = int(WINDOW_SECONDS * 1000)
    window_start_ms = max(0, total_ms - window_ms)
    sliced = audio[window_start_ms:]

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    sliced.export(tmp.name, format="wav")
    tmp.close()
    return tmp.name, window_start_ms / 1000.0, total_duration


def _stabilize_speaker_labels(
    merged: list[dict],
    committed: list[dict],
    session: _LiveSession,
) -> list[dict]:
    """Map this-tick's "Speaker N" labels (allocated by merge_segments per-call,
    not consistent across calls) to session-stable speaker labels.

    For each unique per-call label, find the committed segment with the
    largest temporal overlap. If meaningful overlap exists, inherit that
    speaker; otherwise allocate a new Speaker N off the session counter.
    """
    per_call_to_stable: dict[str, str] = {}

    def stable_for(per_call_label: str, anchor: dict) -> str:
        if per_call_label in per_call_to_stable:
            return per_call_to_stable[per_call_label]
        best = None
        best_overlap = 0.0
        for c in committed:
            o = max(0.0, min(anchor["end"], c["end"]) - max(anchor["start"], c["start"]))
            if o > best_overlap:
                best_overlap = o
                best = c
        if best is not None and best_overlap >= 0.5:
            stable = best["speaker"]
        else:
            session.next_speaker_id += 1
            stable = f"Speaker {session.next_speaker_id}"
        per_call_to_stable[per_call_label] = stable
        return stable

    return [{**s, "speaker": stable_for(s["speaker"], s)} for s in merged]


@bp.route("/api/transcribe/live", methods=["POST"])
@jwt_required()
def transcribe_live():
    """Append a chunk, re-transcribe the trailing window, return committed + interim.

    Form fields:
      chunk        — the 2s MediaRecorder timeslice blob (required)
      session_id   — UUID returned by the first tick (omit on first call)
      diarize      — "true" / "false" (default false). Heavy; only enable when
                     the user has opted into live speaker labels.

    Response:
      { session_id, committed: [...], interim: [...], total_duration }

    Segment shape:
      { speaker: "Speaker N" | null, start: seconds, end: seconds, text: str }
    """
    if "chunk" not in request.files:
        return jsonify({"error": "No chunk uploaded"}), 400

    user_id = get_jwt_identity()
    diarize = _truthy(request.form.get("diarize", "false"))
    session_id = request.form.get("session_id")

    new_session = False
    with _registry_lock:
        _cleanup_expired_locked()
        if session_id and session_id in _sessions:
            sess = _sessions[session_id]
            if sess.user_id != user_id:
                # Don't leak existence of someone else's session.
                return jsonify({"error": "Session not found"}), 404
        else:
            # Starting a fresh session — enforce the concurrency caps so a
            # client can't open sessions without bound. Expired sessions were
            # just swept, so these counts reflect genuinely-live sessions.
            if len(_sessions) >= MAX_ACTIVE_SESSIONS:
                return jsonify({
                    "error": "live_capacity",
                    "message": "The server is at its live-transcription capacity. Try again shortly.",
                }), 429
            if sum(1 for s in _sessions.values() if s.user_id == user_id) >= MAX_SESSIONS_PER_USER:
                return jsonify({
                    "error": "too_many_sessions",
                    "message": "Too many live transcription sessions open. Finish one and retry.",
                }), 429
            session_id, sess = _new_session_locked(user_id)
            new_session = True
        sess.last_touched = time.time()

    # Audit once, when a session is first opened — not on every 2s tick, which
    # would flood the log. This is the PHI-capture event for live recording;
    # the per-tick chunks and the final /api/transcribe pass are covered
    # separately. The audit write is best-effort and never blocks the tick.
    if new_session:
        log_action(
            'audio.transcribe_live',
            user_id=user_id,
            resource_type='audio',
            resource_id=session_id,
            extra={'diarize': diarize},
        )
        db.session.commit()

    # Serialize ticks for THIS session so concurrent in-flight requests can't
    # race on the appended file or on session.committed_segments. Other
    # sessions tick freely in parallel.
    with sess.lock:
        chunk = request.files["chunk"]
        try:
            _write_session_audio(sess.audio_path, chunk)
        except SessionSizeExceeded:
            # The recording outgrew the live-preview cap; every subsequent
            # full-blob upload will too, so the preview stops updating and the
            # session ages out via the TTL. The browser keeps recording — the
            # full audio still goes through /api/transcribe on stop.
            return jsonify({
                "error": "session_limit",
                "message": "Live preview reached its size limit. Stop the recording to transcribe the full audio.",
            }), 413

        try:
            wav_path, window_start_abs, total_duration = _decode_and_slice(sess.audio_path)
        except Exception as e:
            logger.error(f"Live decode failure: {type(e).__name__}: {e}")
            return jsonify({"error": "decode_failed", "message": str(e)}), 500

        try:
            try:
                _text, segs, _words = transcribe_path(wav_path)
            except Exception as e:
                logger.error(f"Live transcribe failure: {type(e).__name__}: {e}")
                return jsonify({"error": "transcription_failed", "message": str(e)}), 500

            # Shift whisper's window-relative segment times into absolute
            # session time so committed/interim ranges are comparable across
            # ticks.
            for s in segs:
                s["start"] += window_start_abs
                s["end"] += window_start_abs

            if diarize:
                try:
                    turns = diarize_path(wav_path)
                    for t in turns:
                        t["start"] += window_start_abs
                        t["end"] += window_start_abs
                    merged = merge_segments(segs, turns)
                    merged = _stabilize_speaker_labels(
                        merged, sess.committed_segments, sess
                    )
                except DiarizationUnavailable as e:
                    logger.warning(f"Live diarization unavailable: {e}")
                    merged = [{
                        "speaker": None,
                        "start": s["start"],
                        "end": s["end"],
                        "text": s["text"].strip(),
                    } for s in segs]
            else:
                merged = [{
                    "speaker": None,
                    "start": s["start"],
                    "end": s["end"],
                    "text": s["text"].strip(),
                } for s in segs]

            # Committed = segment ended before (total_duration - COMMIT_CUTOFF).
            # That's the safe zone — the next tick's window won't extend
            # backward, so these segments won't be re-transcribed.
            commit_cutoff = max(0.0, total_duration - COMMIT_CUTOFF_SECONDS)
            window_left = window_start_abs

            # Replace any previously-committed segments that fall inside the
            # current window with the fresh authoritative versions. Segments
            # entirely before the window are unaffected.
            surviving = [c for c in sess.committed_segments if c["end"] <= window_left]
            newly_committed = [m for m in merged if m["end"] < commit_cutoff]
            interim = [m for m in merged if m["end"] >= commit_cutoff]

            sess.committed_segments = surviving + newly_committed

            return jsonify({
                "session_id": session_id,
                "committed": sess.committed_segments,
                "interim": interim,
                "total_duration": total_duration,
            })
        finally:
            try:
                os.unlink(wav_path)
            except OSError:
                pass


@bp.route("/api/transcribe/live/finalize", methods=["POST"])
@jwt_required()
def finalize_live():
    """Tear down a live session and delete its temp audio file.

    Safe to call twice / on a session that was already TTL-cleaned — returns
    204 either way so the client doesn't need to special-case races.
    """
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id")
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    with _registry_lock:
        sess = _sessions.get(session_id)
        if sess is None:
            return ("", 204)
        if sess.user_id != user_id:
            return jsonify({"error": "Session not found"}), 404
        _sessions.pop(session_id, None)

    try:
        os.unlink(sess.audio_path)
    except OSError:
        pass
    return ("", 204)
