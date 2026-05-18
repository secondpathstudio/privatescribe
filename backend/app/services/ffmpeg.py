"""ffmpeg binary resolution.

pydub shells out to an ffmpeg binary to decode uploaded audio — both the
upload path (services/whisper.py, which calls `AudioSegment.converter`
directly) and the live-recording path (routes/transcription_live.py, via
`AudioSegment.from_file`/`.export`).

In a dev setup ffmpeg is on PATH (Homebrew). In the packaged desktop app it
is *not*: nothing installs a system ffmpeg, so pydub's default `'ffmpeg'`
resolves to nothing and an upload fails with
``[Errno 2] No such file or directory: 'ffmpeg'``.

The fix is the same shape as the bundled Ollama runtime: ship a binary. We
depend on the `imageio-ffmpeg` wheel, which carries a static, platform-native
ffmpeg. This module resolves that binary and points pydub at it once, at boot,
via `AudioSegment.converter`.

Resolution order:
  1. PRIVATESCRIBE_FFMPEG env var — operator override / escape hatch.
  2. imageio-ffmpeg's bundled static binary — the normal path, dev and packaged.
  3. ffmpeg on PATH — last-resort fallback if imageio-ffmpeg is unavailable.
"""
import logging
import os
import shutil

logger = logging.getLogger(__name__)

_resolved: str | None = None


def _from_imageio() -> str | None:
    """Path to imageio-ffmpeg's bundled static ffmpeg, or None."""
    try:
        import imageio_ffmpeg
    except ImportError:
        return None
    try:
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:  # defensive — never let resolution crash boot
        logger.warning("imageio-ffmpeg present but get_ffmpeg_exe() failed: %s", e)
        return None
    if not exe or not os.path.exists(exe):
        return None
    # PyInstaller's collect_data_files can drop the executable bit when it
    # bundles the wheel into the packaged app; restore it best-effort so the
    # subprocess spawn doesn't fail with EACCES.
    if not os.access(exe, os.X_OK):
        try:
            os.chmod(exe, 0o755)
        except OSError:
            pass
    return exe


def resolve_ffmpeg() -> str | None:
    """Return the ffmpeg binary path to use, or None if none can be found."""
    override = os.getenv("PRIVATESCRIBE_FFMPEG")
    if override and os.path.exists(override):
        return override
    bundled = _from_imageio()
    if bundled:
        return bundled
    return shutil.which("ffmpeg")


def configure() -> str | None:
    """Resolve ffmpeg and point pydub at it. Called once from create_app().

    Returns the resolved path, or None if no ffmpeg could be found at all — in
    which case transcription still fails on the first upload (as it did
    before), but the cause is now logged loudly at boot instead of surfacing
    only as a cryptic FileNotFoundError mid-request.
    """
    global _resolved
    _resolved = resolve_ffmpeg()

    # Point pydub at the resolved binary so AudioSegment.converter (used by
    # whisper.py's transcode and by transcription_live.py's from_file/export)
    # no longer relies on a bare 'ffmpeg' being on PATH.
    from pydub import AudioSegment

    if _resolved:
        AudioSegment.converter = _resolved
        logger.info("ffmpeg resolved: %s", _resolved)
    else:
        logger.error(
            "No ffmpeg binary found — audio transcription will fail. Install "
            "ffmpeg, install the imageio-ffmpeg package, or set "
            "PRIVATESCRIBE_FFMPEG to a binary path."
        )
    return _resolved


def get_ffmpeg() -> str | None:
    """The ffmpeg path resolved by configure(), or None if not yet configured."""
    return _resolved
