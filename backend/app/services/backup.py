"""Encrypted backup of the database and audio (roadmap Phase 7 / HIPAA GAP-05).

Produces a single archive holding a transactionally-consistent snapshot of the
SQLCipher database plus the AES-GCM-encrypted audio files. The DB snapshot is
taken with ``VACUUM INTO``, which yields a same-key-encrypted copy of the
latest committed state — WAL frames included — without stopping the server or
checkpointing manually. Both the DB and the audio are already ciphertext, so
the archive carries no plaintext PHI.

The ``SQLCIPHER_KEY`` (in ``.env``) is deliberately **not** included: the key
sitting next to the ciphertext would defeat the encryption. Operators back the
key up separately — without it the archive is unrecoverable. The companion
restore path verifies the per-file checksums recorded in the manifest.
"""
import hashlib
import io
import json
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

from flask import current_app

from app.security import sqlcipher

FORMAT_VERSION = 1
DB_NAME = "privatescribe.db"
MANIFEST_NAME = "manifest.json"
_CHUNK = 1024 * 1024


def _sha256(path: Path) -> tuple[str, int]:
    """Return ``(hex_digest, byte_count)`` for a file, read in chunks."""
    h = hashlib.sha256()
    total = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            h.update(chunk)
            total += len(chunk)
    return h.hexdigest(), total


def _snapshot_db(dest: Path) -> None:
    """Write a consistent, same-key-encrypted DB snapshot to ``dest``.

    ``VACUUM INTO`` runs outside a transaction and reads the latest committed
    state, so it is safe while the server is serving and needs no explicit WAL
    checkpoint. A fresh keyed connection is used because the request-scoped
    session wraps statements in a transaction, which VACUUM cannot run inside.
    """
    conn = sqlcipher.open_keyed_connection()
    try:
        conn.execute("VACUUM INTO ?", (str(dest),))
    finally:
        conn.close()


def create_backup(out_path: Path, *, include_audio: bool = True) -> dict:
    """Create a backup archive at ``out_path``; return a summary dict.

    The archive is a gzip tar of ``privatescribe.db`` (a VACUUM snapshot),
    ``audio/*`` (when ``include_audio``), and ``manifest.json`` (format version,
    timestamp, and a SHA-256 + size for every data file, for restore-time
    integrity checks).
    """
    out_path = Path(out_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    instance = Path(current_app.instance_path)
    audio_dir = instance / "audio"

    staging = Path(tempfile.mkdtemp(prefix="ps-backup-"))
    try:
        snapshot = staging / DB_NAME
        _snapshot_db(snapshot)

        files: dict[str, dict] = {}
        with tarfile.open(out_path, "w:gz") as tar:
            db_sha, db_bytes = _sha256(snapshot)
            files[DB_NAME] = {"sha256": db_sha, "bytes": db_bytes}
            tar.add(snapshot, arcname=DB_NAME)

            audio_count = 0
            if include_audio and audio_dir.is_dir():
                for f in sorted(audio_dir.iterdir()):
                    if not f.is_file():
                        continue
                    try:
                        sha, n = _sha256(f)
                    except FileNotFoundError:
                        # Deleted mid-backup (purge job, etc.) — skip it.
                        continue
                    arc = f"audio/{f.name}"
                    files[arc] = {"sha256": sha, "bytes": n}
                    tar.add(f, arcname=arc)
                    audio_count += 1

            manifest = {
                "format_version": FORMAT_VERSION,
                "created_at": datetime.utcnow().isoformat() + "Z",
                "includes_audio": include_audio,
                "files": files,
                "note": (
                    "Encrypted with SQLCIPHER_KEY. Store the key (.env) "
                    "separately — this archive is unrecoverable without it."
                ),
            }
            data = json.dumps(manifest, indent=2).encode("utf-8")
            info = tarfile.TarInfo(MANIFEST_NAME)
            info.size = len(data)
            info.mtime = int(datetime.utcnow().timestamp())
            tar.addfile(info, io.BytesIO(data))

        archive_sha, archive_bytes = _sha256(out_path)
        return {
            "out_path": str(out_path),
            "db_bytes": db_bytes,
            "audio_count": audio_count,
            "archive_bytes": archive_bytes,
            "archive_sha256": archive_sha,
            "includes_audio": include_audio,
        }
    finally:
        # Drop the staged snapshot (and any -wal/-shm VACUUM may leave).
        for p in staging.iterdir():
            try:
                p.unlink()
            except OSError:
                pass
        try:
            staging.rmdir()
        except OSError:
            pass
