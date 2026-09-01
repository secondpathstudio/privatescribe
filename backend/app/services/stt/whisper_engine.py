"""Faster-Whisper as a TranscriptionEngine adapter.

A thin delegation layer over services/whisper.py — the module keeps its
model cache, locks, and download management (whisper_manager) exactly as
before, so wiring call sites through the registry is behavior-neutral.
Whisper is the reference engine: it's the only one with every capability,
which is why it is also the fallback when the `stt_engine` setting names
something unknown.
"""
from typing import Iterator

from app.services import whisper
from app.services.stt.base import EngineCapabilities, TranscriptionEngine


class WhisperEngine(TranscriptionEngine):
    name = "whisper"
    capabilities = EngineCapabilities(
        word_confidence=True,
        segment_timestamps=True,
        prompt_biasing=True,
        live_ticks=True,
    )

    def transcribe_streaming(
        self,
        wav_path: str,
        language: str = "en",
        *,
        initial_prompt: str | None = None,
        batched: bool = False,
    ) -> Iterator[tuple[str, object]]:
        yield from whisper.transcribe_path_streaming(
            wav_path, language, initial_prompt=initial_prompt, batched=batched
        )

    def loaded_description(self) -> str | None:
        return whisper.loaded_model_size()

    def reload(self) -> None:
        whisper.reload_model()
