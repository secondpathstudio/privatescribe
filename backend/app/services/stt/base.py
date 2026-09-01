"""Engine-neutral speech-to-text contract.

PrivateScribe historically had exactly one STT engine (Faster-Whisper,
services/whisper.py) and call sites imported that module directly. To support
alternate engines (first up: Google's MedASR for medical dictation) without
scattering per-engine branches, each engine is an adapter implementing this
small interface, and callers resolve the active one via stt.get_engine().

Two rules keep this from decaying as engines are added:

- Callers branch on ``capabilities``, never on the engine name. An engine
  that can't produce per-word confidence declares word_confidence=False and
  the confidence-highlighting UI simply doesn't render — no route or
  component ever needs to know which engine ran.
- Engine quirks stay inside the adapter. Whatever cleanup a model's raw
  output needs (special-token stripping, chunking parameters, section-header
  normalization, ...) happens before events leave transcribe_streaming();
  downstream code (dictation markers, abbreviation expansion, the LLM pass)
  always sees clean text. Shared helpers get extracted only once a second
  engine actually needs the same fix.

Audio decoding is deliberately NOT part of the contract: adapters take a
16 kHz mono WAV path (whisper.prepare_wav's output) so the hardened ffmpeg
decode path stays engine-agnostic.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Iterator


@dataclass(frozen=True)
class EngineCapabilities:
    """What an engine can honestly produce.

    Routes and the frontend consult these flags to degrade features
    gracefully; they must never fabricate the corresponding data (e.g. an
    engine without word_confidence yields an empty words list, not invented
    probabilities).
    """

    word_confidence: bool      # per-word probabilities → confidence highlighting
    segment_timestamps: bool   # timed segments → diarization speaker alignment
    prompt_biasing: bool       # decode-time vocabulary biasing via initial_prompt
    live_ticks: bool           # fast enough on CPU for the 2s live-preview loop


class TranscriptionEngine(ABC):
    """One speech-to-text engine. Register instances in stt/__init__.py."""

    #: Registry key, also what the `stt_engine` setting stores. Stable —
    #: renaming one orphans existing installs' setting rows.
    name: str
    capabilities: EngineCapabilities

    @abstractmethod
    def transcribe_streaming(
        self,
        wav_path: str,
        language: str = "en",
        *,
        initial_prompt: str | None = None,
        batched: bool = False,
    ) -> Iterator[tuple[str, object]]:
        """Yield ``("progress", fraction)`` events, then one
        ``("result", (text, segments, words))``.

        The contract is identical to whisper.transcribe_path_streaming — see
        its docstring for the segments/words shapes. Engines lacking a
        capability yield empty lists for the corresponding slot. Both keyword
        arguments are hints, not demands: an engine without prompt_biasing
        accepts and ignores ``initial_prompt``, and ``batched`` is a
        may-go-faster flag — so callers never branch before calling.
        """

    def transcribe(
        self,
        wav_path: str,
        language: str = "en",
        *,
        initial_prompt: str | None = None,
    ) -> tuple[str, list[dict], list[dict]]:
        """Blocking convenience wrapper for callers that don't need progress."""
        result: tuple[str, list[dict], list[dict]] | None = None
        for kind, payload in self.transcribe_streaming(
            wav_path, language, initial_prompt=initial_prompt
        ):
            if kind == "result":
                result = payload  # type: ignore[assignment]
        assert result is not None, "transcribe_streaming did not yield a result"
        return result

    @abstractmethod
    def loaded_description(self) -> str | None:
        """What's currently held in memory (for the admin status endpoint),
        or None if nothing is loaded yet — e.g. Whisper reports its size."""

    @abstractmethod
    def reload(self) -> None:
        """Drop cached weights so the next use picks up changed settings."""
