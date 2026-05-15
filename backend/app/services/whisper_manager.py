"""Whisper model installation manager.

Downloads faster-whisper model weights from the Hugging Face Hub with
streaming byte-level progress so the admin UI can render a real progress
bar. This exists separately from `whisper.py` (which loads/runs the model)
because the app is meant to run offline: the admin pre-downloads a model
while connected, watches it complete, then disconnects. Lazy
download-on-first-use would defeat that.

Implementation notes:
  * faster-whisper resolves a size like "small" to the HF repo
    `Systran/faster-whisper-small` (see faster_whisper.utils._MODELS).
    We download into the same HF cache faster-whisper reads from, so a
    later `WhisperModel("small")` finds the cached snapshot and does no
    network I/O.
  * Progress comes from a custom `tqdm_class` handed to
    `huggingface_hub.snapshot_download`. snapshot_download spins one tqdm
    per file; our subclass reports each file's byte counter. The service
    keeps a running base offset over already-finished files so the
    emitted `completed`/`total` are whole-download absolute byte counts.
  * The download runs on a worker thread because snapshot_download is
    blocking; events cross back to the request generator over a queue.
"""
from __future__ import annotations

import queue
import threading
from pathlib import Path
from typing import Callable, Generator, Optional

import huggingface_hub
from huggingface_hub.constants import HF_HUB_CACHE
from huggingface_hub.utils import tqdm as _hf_tqdm

# Sizes offered in the admin UI. English-only (.en) and distil variants are
# deliberately left out for v1 to keep the choice simple — these five span
# the speed/accuracy range most users care about.
AVAILABLE_MODELS = ["tiny", "base", "small", "medium", "large-v3"]

# Rough on-disk footprint, shown in the UI before download so the admin can
# gauge bandwidth/disk. Real totals are computed from HF metadata at install
# time; these are just for the pre-flight estimate.
APPROX_SIZE_MB = {
    "tiny": 75,
    "base": 145,
    "small": 485,
    "medium": 1530,
    "large-v3": 3090,
}

# Files faster-whisper actually needs from a model repo. Mirrors the
# allow_patterns in faster_whisper.utils.download_model so our cached
# snapshot looks exactly like the one faster-whisper would have fetched.
_ALLOW_PATTERNS = [
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.*",
]


def _repo_id(size: str) -> str:
    return f"Systran/faster-whisper-{size}"


def _repo_cache_dir(size: str) -> Path:
    # HF stores repos as `models--<org>--<name>` under HF_HUB_CACHE.
    return Path(HF_HUB_CACHE) / f"models--Systran--faster-whisper-{size}"


def is_installed(size: str) -> bool:
    """True when a usable snapshot of this size's repo is in the HF cache.

    "Usable" means a snapshot directory with a `model.bin` — the weight
    blob. A repo dir with only refs/blobs but no completed snapshot (an
    aborted download) reads as not installed, which is what we want.
    """
    snapshots = _repo_cache_dir(size) / "snapshots"
    if not snapshots.is_dir():
        return False
    for snap in snapshots.iterdir():
        if (snap / "model.bin").exists():
            return True
    return False


def installed_models() -> list[str]:
    return [m for m in AVAILABLE_MODELS if is_installed(m)]


class _ProgressTqdm(_hf_tqdm):
    """tqdm subclass that reports byte progress to a per-thread callback.

    huggingface_hub builds one tqdm per file. We can't pass instance state
    through snapshot_download, so the callback is stashed on a threading-
    local that the download worker sets before kicking off the download.
    """

    def update(self, n: int = 1):
        displayed = super().update(n)
        cb: Optional[Callable] = getattr(_tls, "callback", None)
        if cb is not None and self.total:
            cb(int(self.n), int(self.total))
        return displayed


_tls = threading.local()


def download_model_stream(size: str) -> Generator[dict, None, None]:
    """Download a model, yielding progress events.

    Event shapes (one dict per yield):
      {"status": "starting", "model": size, "totalBytes": int}
      {"status": "downloading", "completed": int, "total": int}
      {"status": "success", "model": size}
      {"status": "error", "message": str}

    `completed`/`total` are whole-download absolute byte counts. The caller
    (admin route) serializes each event to one NDJSON line.
    """
    if size not in AVAILABLE_MODELS:
        yield {"status": "error", "message": f"Unknown model size: {size!r}"}
        return

    if is_installed(size):
        # Already cached — nothing to download. Emit a trivially-complete
        # stream so the client's success path still fires.
        yield {"status": "starting", "model": size, "totalBytes": 0}
        yield {"status": "success", "model": size}
        return

    # Pre-compute the total byte count so progress is a true 0..1 fraction
    # rather than per-file resets. list_repo_tree carries each blob's size.
    try:
        api = huggingface_hub.HfApi()
        tree = api.list_repo_tree(_repo_id(size), recursive=True)
        wanted = ("config.json", "preprocessor_config.json", "model.bin",
                  "tokenizer.json")
        total_bytes = 0
        for entry in tree:
            path = getattr(entry, "path", "")
            size_attr = getattr(entry, "size", None)
            if size_attr is None:
                continue
            if path in wanted or path.startswith("vocabulary"):
                total_bytes += int(size_attr)
    except Exception as e:
        yield {"status": "error", "message": f"Could not reach Hugging Face: {e}"}
        return

    yield {"status": "starting", "model": size, "totalBytes": total_bytes}

    events: queue.Queue = queue.Queue()
    finished = threading.Event()
    error_box: list[BaseException] = []

    # base_completed tracks bytes from files that have fully finished. Each
    # file's tqdm counts from 0, so we add base_completed to get an absolute
    # figure. We bump base_completed when a tqdm reports n == total.
    state = {"base": 0, "current_file_total": 0}

    def on_file_progress(n: int, file_total: int):
        # A new file: its total differs from the one we were tracking.
        if file_total != state["current_file_total"]:
            # The previous file finished — fold its full size into base.
            state["base"] += state["current_file_total"]
            state["current_file_total"] = file_total
        absolute = state["base"] + n
        events.put({
            "status": "downloading",
            "completed": min(absolute, total_bytes) if total_bytes else absolute,
            "total": total_bytes,
        })

    def worker():
        _tls.callback = on_file_progress
        try:
            huggingface_hub.snapshot_download(
                _repo_id(size),
                allow_patterns=_ALLOW_PATTERNS,
                tqdm_class=_ProgressTqdm,
            )
        except BaseException as e:  # noqa: BLE001 — surfaced to the client
            error_box.append(e)
        finally:
            _tls.callback = None
            finished.set()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    # Relay events until the worker signals done, then drain the queue.
    while True:
        try:
            yield events.get(timeout=0.4)
        except queue.Empty:
            if finished.is_set():
                break
    while not events.empty():
        yield events.get_nowait()

    if error_box:
        e = error_box[0]
        yield {"status": "error", "message": f"{type(e).__name__}: {e}"}
        return

    # Sanity-check the snapshot landed before declaring success — guards
    # against a silent partial where snapshot_download returned without the
    # weight blob.
    if not is_installed(size):
        yield {
            "status": "error",
            "message": "Download finished but the model files are missing from the cache.",
        }
        return

    yield {"status": "success", "model": size}
