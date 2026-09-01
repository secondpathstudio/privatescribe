"""Speech-to-text engine registry.

get_engine() resolves the app-wide `stt_engine` setting (default "whisper")
to a TranscriptionEngine adapter. An unknown or stale setting value falls
back to Whisper rather than raising — a hand-edited row or a downgrade past
an engine's removal must never take transcription down.

Adding an engine = one new adapter module here + an entry in _ENGINES.
Nothing else in the app should need to change; callers branch on
engine.capabilities, not on names (see base.py).
"""
from app.services import settings as settings_service
from app.services.stt.base import EngineCapabilities, TranscriptionEngine
from app.services.stt.medasr_engine import MedASREngine
from app.services.stt.whisper_engine import WhisperEngine

__all__ = [
    "EngineCapabilities",
    "TranscriptionEngine",
    "available_engines",
    "get_engine",
]

# Adapter construction is cheap (weights load lazily inside each adapter's
# backing module), so instances are built eagerly at import.
_ENGINES: dict[str, TranscriptionEngine] = {
    engine.name: engine
    for engine in (
        WhisperEngine(),
        MedASREngine(),
    )
}


def available_engines() -> list[str]:
    """Registry keys, for the admin settings UI's engine picker."""
    return sorted(_ENGINES)


def get_engine(name: str | None = None) -> TranscriptionEngine:
    """Return the engine to transcribe with.

    ``name=None`` resolves the admin `stt_engine` setting; passing a name
    supports previews/tests without flipping the app-wide setting.
    """
    if name is None:
        name = settings_service.get_stt_engine()
    return _ENGINES.get(name) or _ENGINES[settings_service.DEFAULT_STT_ENGINE]
