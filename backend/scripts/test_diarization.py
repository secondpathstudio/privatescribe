"""Run the full transcribe + diarize + merge pipeline on a local audio file.

Use this for iterating on diarization without re-recording through the browser.
Skips Flask, JWT, and the frontend entirely — just exercises the services.

    cd backend && source venv/bin/activate
    python scripts/test_diarization.py path/to/audio.wav
    python scripts/test_diarization.py path/to/audio.wav --no-diarize
    python scripts/test_diarization.py path/to/audio.wav --speakers 2
"""
import argparse
import os
import sys
import tempfile

# Make `app.*` importable when running from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()  # pulls HF_TOKEN out of backend/.env so the pipeline can authenticate

from pydub import AudioSegment

from app.services.diarization import (
    DiarizationUnavailable,
    diarize_path,
    merge_segments,
    segments_to_text,
)
from app.services.whisper import transcribe_path


def to_wav(src_path: str) -> tuple[str, bool]:
    """Return (wav_path, owns_temp). If the input is already WAV we reuse it."""
    if src_path.lower().endswith(".wav"):
        return src_path, False
    fmt = src_path.rsplit(".", 1)[-1]
    audio = AudioSegment.from_file(src_path, format=fmt)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    audio.export(tmp.name, format="wav")
    tmp.close()
    return tmp.name, True


def main():
    parser = argparse.ArgumentParser(description="Test diarization on a local audio file.")
    parser.add_argument("audio", help="Path to an audio file (wav/mp3/m4a/webm/...).")
    parser.add_argument("--no-diarize", action="store_true", help="Skip diarization, just transcribe.")
    parser.add_argument("--speakers", type=int, default=None, help="Force a specific speaker count.")
    args = parser.parse_args()

    if not os.path.isfile(args.audio):
        print(f"File not found: {args.audio}", file=sys.stderr)
        sys.exit(1)

    wav_path, owns_temp = to_wav(args.audio)
    try:
        print(f"Transcribing {args.audio} ...")
        text, whisper_segments, _words = transcribe_path(wav_path)
        print(f"  Whisper produced {len(whisper_segments)} segments.\n")

        if args.no_diarize:
            print("=== Flat transcript ===")
            print(text)
            return

        print("Diarizing (cold load takes ~5-10s the first time) ...")
        try:
            turns = diarize_path(wav_path, num_speakers=args.speakers)
        except DiarizationUnavailable as e:
            print(f"\nDiarization unavailable: {e}", file=sys.stderr)
            print("\n=== Falling back to flat transcript ===")
            print(text)
            sys.exit(2)

        print(f"  pyannote produced {len(turns)} speaker turns.\n")

        merged = merge_segments(whisper_segments, turns)
        print("=== Speaker-labeled transcript ===")
        print(segments_to_text(merged))
        print("\n=== Structured segments ===")
        for s in merged:
            print(f"  [{s['start']:6.2f}-{s['end']:6.2f}] {s['speaker']}: {s['text']}")
    finally:
        if owns_temp:
            try:
                os.unlink(wav_path)
            except OSError:
                pass


if __name__ == "__main__":
    main()
