"""Build the self-hosted MedASR weights archive for GitHub Releases.

Produces the asset that services/medasr_manager.py downloads (option C:
self-hosted weights, no Hugging Face account for end users). Run once per
weights version, then upload the zip to a GitHub release whose tag matches
medasr_manager.DEFAULT_WEIGHTS_URL and paste the printed sha256 into
medasr_manager.EXPECTED_SHA256.

Requires an HF_TOKEN (env or backend/.env) whose account has accepted the
google/medasr license and can read gated repos — that's the maintainer's
one-time burden so end users never need it.

The archive contains the unmodified upstream files at the zip root, plus a
NOTICE.txt satisfying the HAI-DEF redistribution terms (the app also shows
the terms link and records the operator's acceptance before install).

    cd backend && source venv/bin/activate
    python scripts/package_medasr_weights.py [output-dir]
"""
import hashlib
import os
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from huggingface_hub import snapshot_download  # noqa: E402

REPO_ID = "google/medasr"
VERSION = "v1"
TERMS_URL = "https://developers.google.com/health-ai-developer-foundations/terms"

# Only what the transformers ASR pipeline actually loads, plus the README
# for upstream attribution. Deliberately excluded: lm_6.kenlm / lm_6.arpa.xz
# (an optional ~940MB KenLM rescoring LM the pipeline never reads),
# test_audio.wav, notebook.ipynb.
ALLOW = (
    "model.safetensors",
    "config.json",
    "preprocessor_config.json",
    "processor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "added_tokens.json",
    "spiece.model",
    "README.md",
)

NOTICE = f"""MedASR model weights ({REPO_ID})

These files are redistributed, unmodified, from {REPO_ID} on Hugging Face
under the Google Health AI Developer Foundations Terms of Use:
    {TERMS_URL}

Your use of these files is governed by those terms, including their use
restrictions and prohibited use policy. PrivateScribe requires an
administrator to acknowledge these terms before the model is installed.
"""


def main() -> int:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    out_path = out_dir / f"medasr-weights-{VERSION}.zip"

    token = os.getenv("HF_TOKEN")
    if not token:
        env = Path(__file__).resolve().parents[1] / ".env"
        if env.is_file():
            for line in env.read_text().splitlines():
                if line.startswith("HF_TOKEN="):
                    token = line.split("=", 1)[1].strip()
    if not token:
        print("ERROR: HF_TOKEN not set (env or backend/.env).")
        return 1

    print(f"Downloading {REPO_ID} snapshot ...")
    snap = Path(snapshot_download(REPO_ID, token=token, allow_patterns=list(ALLOW)))

    files = sorted(p for p in snap.rglob("*") if p.is_file() and p.name in ALLOW)
    print(f"Packing {len(files)} files -> {out_path}")
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in files:
            zf.write(p, p.relative_to(snap))
        zf.writestr("NOTICE.txt", NOTICE)

    digest = hashlib.sha256(out_path.read_bytes()).hexdigest()
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"\nDone: {out_path}  ({size_mb:.0f} MB)")
    print(f"sha256: {digest}")
    print(
        "\nNext steps:\n"
        f"  1. Upload to a GitHub release tagged medasr-weights-{VERSION} with the\n"
        f"     asset name medasr-weights-{VERSION}.zip (see medasr_manager.DEFAULT_WEIGHTS_URL).\n"
        f"  2. Set medasr_manager.EXPECTED_SHA256 = \"{digest}\"\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
