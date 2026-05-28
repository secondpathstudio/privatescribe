"""De-risk smoke test: boot the PyInstaller-frozen backend on each OS.

Given the onedir output directory, spawns the frozen `privatescribe-backend`
binary against a throwaway data dir and a fixed port, then polls the
unauthenticated GET /api/setup/status until it answers. A 200/JSON response
proves the *entire* frozen stack came up on this OS: every heavy native dep
imported (torch, ctranslate2, onnxruntime, av, pyannote, faster-whisper,
speechbrain), the keyed SQLCipher engine opened, db.create_all ran, and the
FTS5 table built — i.e. create_app() succeeded end-to-end in a frozen binary.

Usage:  python derisk/backend_smoke.py <onedir-dir>
Exits non-zero (and dumps the backend's captured output) on any failure.

Throwaway: delete with derisk/ once the real matrix build is green.
"""
import os
import sys
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

PORT = "5005"
URL = f"http://127.0.0.1:{PORT}/api/setup/status"
BOOT_TIMEOUT_S = 180  # first frozen boot is slow (extraction + heavy imports)


def main() -> None:
    onedir = sys.argv[1]
    name = "privatescribe-backend" + (".exe" if sys.platform.startswith("win") else "")
    binary = os.path.join(onedir, name)
    if not os.path.exists(binary):
        sys.exit(f"FAIL: frozen binary not found at {binary}")

    data_dir = tempfile.mkdtemp(prefix="ps-smoke-")
    env = dict(os.environ)
    env["PRIVATESCRIBE_DATA_DIR"] = data_dir  # writable .env + DB + audio land here
    env["PRIVATESCRIBE_PORT"] = PORT          # pin the port so we know where to poll
    # PRIVATESCRIBE_MODE unset -> standalone -> binds 127.0.0.1. No HF_TOKEN ->
    # diarization pre-warm is skipped. No OLLAMA_HOST needed to boot.

    log_path = os.path.join(data_dir, "backend.out")
    log = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(binary, env=env, stdout=log, stderr=subprocess.STDOUT)

    def dump_and_exit(msg: str) -> None:
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        log.close()
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            captured = f.read()
        print(f"\n----- backend output -----\n{captured}\n--------------------------")
        sys.exit(msg)

    deadline = time.time() + BOOT_TIMEOUT_S
    while time.time() < deadline:
        if proc.poll() is not None:
            dump_and_exit(f"FAIL: backend exited early with code {proc.returncode}")
        try:
            with urllib.request.urlopen(URL, timeout=3) as resp:
                body = resp.read(500).decode("utf-8", "replace")
                print(f"OK [{sys.platform}] frozen backend booted — {URL} -> "
                      f"HTTP {resp.status}; body: {body}")
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except Exception:
                    proc.kill()
                log.close()
                return
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(2)  # not serving yet

    dump_and_exit(f"FAIL: backend did not answer {URL} within {BOOT_TIMEOUT_S}s")


if __name__ == "__main__":
    main()
