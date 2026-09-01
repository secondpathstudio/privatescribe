"""Google MedASR as a TranscriptionEngine adapter.

MedASR (huggingface.co/google/medasr) is a 105M-parameter Conformer CTC
model fine-tuned on ~5,000 hours of physician dictation. On medical speech
it transcribes clinical vocabulary (drug names, exam findings) markedly
better than Whisper, applies clinical normalization ("forty milligrams" →
"40 mg"), and inserts the section headers the dictation implies (e.g.
"[PAST MEDICAL HISTORY]", "[PLAN]"). Headers are kept verbatim in the raw
transcript by design: they're real structure the model inferred, the LLM
formatting pass reads them fine, and stripping them would lose information.

Capability honesty (see base.py): the transformers CTC pipeline cannot
currently produce word or segment timestamps for this model (its
sentencepiece tokenizer breaks the pipeline's CTC timestamp decode paths),
so word_confidence and segment_timestamps are declared False and this
engine yields empty segments/words rather than fabricating them. There is
no decode-time vocabulary biasing either — the model's medical training is
the substitute. live_ticks is True: a 2s tick decodes in ~0.5s on CPU.

Quirks handled here, per the adapter contract:
- sentencepiece special tokens ("</s>") leak into decoded text → stripped;
- long-form chunking runs at 30s chunks / 5s stride — the pipeline default
  (20/2) produced garbled text at section-header boundaries in testing.

The model is gated on Hugging Face: downloading weights requires an
HF_TOKEN whose account accepted the model license (same env var pyannote
diarization uses; huggingface_hub picks it up automatically). Once cached,
loading is offline like every other model in the app.

transformers is imported lazily on first use so installs without the
dependency still boot — selecting this engine then fails with a clear
error at transcription time instead of taking the whole backend down.
English-only model; the ``language`` argument is accepted and ignored.
"""
import re
import threading
from typing import Iterator

from app.services.stt.base import EngineCapabilities, TranscriptionEngine

MODEL_ID = "google/medasr"
# Spike-validated long-form parameters (see module docstring).
CHUNK_LENGTH_S = 30
STRIDE_LENGTH_S = 5

_pipeline = None
# Serializes first-use construction (mirrors whisper._model_lock — two
# concurrent first requests must not race the weight download/load).
_pipeline_lock = threading.Lock()
# Serializes inference so concurrent callers don't thrash a CPU-only box
# (mirrors whisper.inference_lock).
_inference_lock = threading.Lock()

# Sentencepiece specials the CTC decode leaks into text.
_SPECIAL_TOKENS = re.compile(r"</?s>|<pad>|<unk>")


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        with _pipeline_lock:
            if _pipeline is None:
                try:
                    from transformers import pipeline
                except ImportError as e:
                    raise RuntimeError(
                        "The MedASR engine requires the 'transformers' package. "
                        "Install backend requirements or switch the transcription "
                        "engine back to Whisper."
                    ) from e
                _pipeline = pipeline(
                    "automatic-speech-recognition", model=MODEL_ID, device="cpu"
                )
    return _pipeline


def _clean(text: str) -> str:
    """Strip leaked special tokens and collapse the resulting whitespace."""
    text = _SPECIAL_TOKENS.sub(" ", text)
    return re.sub(r"[ \t]+", " ", text).strip()


class MedASREngine(TranscriptionEngine):
    name = "medasr"
    capabilities = EngineCapabilities(
        word_confidence=False,
        segment_timestamps=False,
        prompt_biasing=False,
        live_ticks=True,
    )

    def transcribe_streaming(
        self,
        wav_path: str,
        language: str = "en",  # accepted per contract; model is English-only
        *,
        initial_prompt: str | None = None,  # no prompt biasing — ignored
        batched: bool = False,  # pipeline chunking already batches — ignored
    ) -> Iterator[tuple[str, object]]:
        # One blocking pipeline call — the CTC pipeline exposes no per-chunk
        # callback, so there are no intermediate progress events; clients see
        # the stage marker, then the result. At 20-30x realtime on CPU the
        # window without feedback stays short even for long recordings.
        with _inference_lock:
            out = _get_pipeline()(
                wav_path,
                chunk_length_s=CHUNK_LENGTH_S,
                stride_length_s=STRIDE_LENGTH_S,
            )
        yield "progress", 1.0
        # Empty segments/words, per the declared capabilities.
        yield "result", (_clean(out.get("text", "")), [], [])

    def loaded_description(self) -> str | None:
        return MODEL_ID if _pipeline is not None else None

    def reload(self) -> None:
        global _pipeline
        _pipeline = None
