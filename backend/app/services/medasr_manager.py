"""MedASR weight installation manager.

Downloads the MedASR model weights as a single self-hosted archive (a
GitHub Releases asset on the PrivateScribe repo — built and uploaded with
scripts/package_medasr_weights.py) with streaming byte-level progress, and
installs them under the app data dir where the MedASR engine looks first.

Why self-hosted instead of Hugging Face (contrast whisper_manager, which
pulls the ungated Systran repos straight from the Hub): google/medasr is a
GATED repo — a Hub download would force every operator to create an HF
account, accept the license there, and mint a token with gated-repo read
permission. Self-hosting keeps the product's no-accounts promise. The
redistribution is done under Google's Health AI Developer Foundations
terms, which permit it provided the terms are passed through to recipients
— hence the license-acceptance gate below and the NOTICE file inside the
archive. The archive is produced unmodified from the upstream weights.

License gate: the admin must record acceptance of the HAI-DEF terms
(TERMS_URL) before install or activation. The acceptance lives in the
`medasr_license_accepted` system setting (who/when/which terms) and is
written by the accept-license admin route, which also audit-logs it.

Event shapes yielded by download_stream() match whisper_manager's, so the
admin UI reuses one progress component:
  {"status": "starting", "model": "medasr", "totalBytes": int}
  {"status": "downloading", "completed": int, "total": int}
  {"status": "success", "model": "medasr"}
  {"status": "error", "message": str}
"""
from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Generator

import requests

from app.paths import data_dir

TERMS_URL = "https://developers.google.com/health-ai-developer-foundations/terms"

# The self-hosted weights archive. Override with MEDASR_WEIGHTS_URL for
# mirrors or testing. Version the tag/filename together when repackaging so
# an old app never half-matches a new archive.
DEFAULT_WEIGHTS_URL = (
    "https://github.com/secondpathstudio/privatescribe/releases/download/"
    "medasr-weights-v1/medasr-weights-v1.zip"
)

# From scripts/package_medasr_weights.py output — update when the release
# asset is (re)published; None skips verification (dev mirrors). The env var
# override exists so a hotfixed asset doesn't require an app release.
EXPECTED_SHA256: str | None = (
    "8050f3d0637929184a9fb379bdf5b0cd7fd53856704623ab6ea41c6dcbcc4cbc"
)

# Pre-flight size hint for the admin UI (the real total comes from the
# response's Content-Length at download time).
APPROX_SIZE_MB = 410

# Files that must exist for the install to count as usable. config.json +
# the safetensors blob are what transformers' pipeline actually loads.
_REQUIRED_FILES = ("config.json", "model.safetensors")

_DOWNLOAD_CHUNK = 1024 * 256


def weights_url() -> str:
    return os.getenv("MEDASR_WEIGHTS_URL") or DEFAULT_WEIGHTS_URL


def expected_sha256() -> str | None:
    return os.getenv("MEDASR_WEIGHTS_SHA256") or EXPECTED_SHA256


def install_dir() -> Path:
    return data_dir() / "medasr-model"


def is_installed() -> bool:
    d = install_dir()
    return all((d / f).is_file() for f in _REQUIRED_FILES)


def _safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    """Extract, refusing member paths that would escape dest (zip-slip)."""
    dest = dest.resolve()
    for member in zf.infolist():
        target = (dest / member.filename).resolve()
        if not target.is_relative_to(dest):
            raise RuntimeError(f"Archive contains an unsafe path: {member.filename!r}")
    zf.extractall(dest)


def download_stream() -> Generator[dict, None, None]:
    """Download + install the weights archive, yielding progress events.

    The install is atomic from the engine's point of view: the archive is
    extracted into a temp directory next to the final location and swapped
    in with a rename, so a crash or failed download can never leave a
    half-written install that is_installed() would approve.
    """
    if is_installed():
        yield {"status": "starting", "model": "medasr", "totalBytes": 0}
        yield {"status": "success", "model": "medasr"}
        return

    url = weights_url()
    tmp_zip = None
    tmp_extract = None
    try:
        resp = requests.get(url, stream=True, timeout=30)
        if resp.status_code != 200:
            yield {
                "status": "error",
                "message": f"Weights download failed: HTTP {resp.status_code} from {url}",
            }
            return
        total = int(resp.headers.get("Content-Length") or 0)
        yield {"status": "starting", "model": "medasr", "totalBytes": total}

        digest = hashlib.sha256()
        completed = 0
        fd, tmp_zip = tempfile.mkstemp(suffix=".zip", dir=str(data_dir()))
        with os.fdopen(fd, "wb") as f:
            for chunk in resp.iter_content(chunk_size=_DOWNLOAD_CHUNK):
                f.write(chunk)
                digest.update(chunk)
                completed += len(chunk)
                yield {"status": "downloading", "completed": completed, "total": total}

        expected = expected_sha256()
        if expected and digest.hexdigest().lower() != expected.lower():
            yield {
                "status": "error",
                "message": "Downloaded archive failed its integrity check "
                           "(sha256 mismatch). Try again; if it persists, the "
                           "hosted asset may be corrupt.",
            }
            return

        tmp_extract = Path(tempfile.mkdtemp(dir=str(data_dir())))
        with zipfile.ZipFile(tmp_zip) as zf:
            _safe_extract(zf, tmp_extract)

        missing = [f for f in _REQUIRED_FILES if not (tmp_extract / f).is_file()]
        if missing:
            yield {
                "status": "error",
                "message": f"Archive is missing required files: {', '.join(missing)}",
            }
            return

        final = install_dir()
        if final.exists():
            shutil.rmtree(final)
        os.rename(tmp_extract, final)
        tmp_extract = None  # consumed by the rename — don't clean it up
        yield {"status": "success", "model": "medasr"}
    except requests.RequestException as e:
        yield {"status": "error", "message": f"Weights download failed: {e}"}
    except (zipfile.BadZipFile, RuntimeError) as e:
        yield {"status": "error", "message": f"Weights archive is invalid: {e}"}
    finally:
        if tmp_zip:
            try:
                os.unlink(tmp_zip)
            except OSError:
                pass
        if tmp_extract is not None:
            shutil.rmtree(tmp_extract, ignore_errors=True)
