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
import shutil
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

import sqlcipher3
from flask import current_app

from app.security import sqlcipher

FORMAT_VERSION = 1
DB_NAME = "privatescribe.db"
MANIFEST_NAME = "manifest.json"
# Naming for archives `flask backup` writes into a directory. Pruning only ever
# matches this glob, so unrelated files in the directory are never touched.
ARCHIVE_PREFIX = "privatescribe-backup-"
ARCHIVE_GLOB = f"{ARCHIVE_PREFIX}*.tar.gz"
_CHUNK = 1024 * 1024


def timestamped_name() -> str:
    """Archive filename for a scheduled backup into a directory."""
    return f"{ARCHIVE_PREFIX}{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}.tar.gz"


def prune_backups(
    directory: Path,
    retention_days: int,
    *,
    keep_current: Path | None = None,
    dry_run: bool = False,
) -> list[Path]:
    """Delete this app's archives in ``directory`` older than ``retention_days``.

    Matches only ``ARCHIVE_GLOB`` (never unrelated files), uses each archive's
    modification time, and never deletes ``keep_current`` (the archive just
    written). ``retention_days <= 0`` keeps everything. Returns the archives
    deleted (or that would be, under ``dry_run``).
    """
    if retention_days <= 0:
        return []
    cutoff = datetime.utcnow().timestamp() - retention_days * 86400
    keep_resolved = keep_current.resolve() if keep_current else None
    pruned: list[Path] = []
    for f in sorted(Path(directory).glob(ARCHIVE_GLOB)):
        if not f.is_file() or f.resolve() == keep_resolved:
            continue
        if f.stat().st_mtime < cutoff:
            if not dry_run:
                try:
                    f.unlink()
                except OSError:
                    continue
            pruned.append(f)
    return pruned


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


class RestoreError(Exception):
    """A restore was refused or failed a safety check; nothing was changed."""


def _safe_members(tar: tarfile.TarFile) -> list[tarfile.TarInfo]:
    """Return the archive members, rejecting anything outside the expected set.

    Guards against path traversal (absolute paths / ``..``) and stray members
    on Python 3.11, which has no built-in extraction filter. Only the DB, the
    manifest, and ``audio/<name>`` files are allowed.
    """
    members: list[tarfile.TarInfo] = []
    for m in tar.getmembers():
        name = m.name
        if name in (DB_NAME, MANIFEST_NAME):
            members.append(m)
            continue
        if name.startswith("audio/"):
            # No nested dirs, no traversal: exactly one path segment after audio/.
            tail = name[len("audio/"):]
            if tail and "/" not in tail and tail not in (".", ".."):
                members.append(m)
                continue
        raise RestoreError(f"Archive contains an unexpected or unsafe entry: {name!r}")
    return members


def _verify_decryptable(db_file: Path) -> None:
    """Confirm the snapshot opens with the *current* SQLCipher key.

    Catches a key mismatch (snapshot from a different install / before a key
    rotation) before any live data is touched — restoring a DB the operator
    can't decrypt would brick the install. Requires the matching ``.env`` key
    to already be in place.
    """
    conn = sqlcipher3.connect(str(db_file))
    try:
        conn.execute(f"PRAGMA key = \"x'{sqlcipher.current_key()}'\"")
        # First statement that actually reads pages — fails on a wrong key.
        conn.execute("SELECT count(*) FROM sqlite_master")
    except sqlcipher3.DatabaseError as e:
        raise RestoreError(
            "The backup's database does not open with the current SQLCIPHER_KEY. "
            "Restore the matching .env / key first, then re-run restore. "
            f"({e})"
        )
    finally:
        conn.close()


def restore_backup(
    archive_path: Path,
    *,
    force: bool = False,
    include_audio: bool = True,
) -> dict:
    """Restore a backup archive into the instance directory.

    Verifies the manifest checksums and that the snapshot decrypts with the
    current key *before* changing anything. The existing DB and audio are moved
    aside into a timestamped ``pre-restore-*`` folder (never deleted), so a
    mistaken restore is recoverable. Refuses to clobber a live DB unless
    ``force`` is set. The server should be stopped during a restore.
    """
    archive_path = Path(archive_path).resolve()
    if not archive_path.is_file():
        raise RestoreError(f"Archive not found: {archive_path}")

    instance = Path(current_app.instance_path)
    live_db = instance / DB_NAME
    live_audio = instance / "audio"

    if live_db.exists() and not force:
        raise RestoreError(
            f"A database already exists at {live_db}. Re-run with --force to "
            "replace it (the current data is moved aside, not deleted)."
        )

    staging = Path(tempfile.mkdtemp(prefix="ps-restore-"))
    try:
        # 1. Extract only safe members.
        with tarfile.open(archive_path, "r:*") as tar:
            members = _safe_members(tar)
            names = {m.name for m in members}
            if DB_NAME not in names or MANIFEST_NAME not in names:
                raise RestoreError("Archive is missing the database or manifest.")
            tar.extractall(staging, members=members)

        # 2. Manifest + format check.
        manifest = json.loads((staging / MANIFEST_NAME).read_text("utf-8"))
        if manifest.get("format_version") != FORMAT_VERSION:
            raise RestoreError(
                f"Unsupported backup format_version "
                f"{manifest.get('format_version')!r} (expected {FORMAT_VERSION})."
            )

        # 3. Verify every recorded file's checksum.
        for rel, meta in manifest["files"].items():
            f = staging / rel
            if not f.is_file():
                raise RestoreError(f"Archive is missing a manifest file: {rel}")
            sha, _ = _sha256(f)
            if sha != meta["sha256"]:
                raise RestoreError(f"Checksum mismatch for {rel} — archive is corrupt.")

        # 4. Confirm the snapshot decrypts with the current key.
        _verify_decryptable(staging / DB_NAME)

        # --- All checks passed; from here we mutate the instance dir. ---
        ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        pre_restore = instance / f"pre-restore-{ts}"
        pre_restore.mkdir(parents=True, exist_ok=True)

        # 5. Move the current DB (and its WAL sidecars) aside.
        for suffix in ("", "-wal", "-shm"):
            p = Path(str(live_db) + suffix)
            if p.exists():
                shutil.move(str(p), str(pre_restore / p.name))
        # And the current audio dir.
        if live_audio.exists():
            shutil.move(str(live_audio), str(pre_restore / "audio"))

        # 6. Put the restored DB in place. The snapshot came from VACUUM INTO,
        #    so it has no WAL sidecars — the old ones are now in pre-restore.
        shutil.move(str(staging / DB_NAME), str(live_db))

        # 7. Restore audio.
        restored_audio = 0
        staged_audio = staging / "audio"
        live_audio.mkdir(parents=True, exist_ok=True)
        if include_audio and staged_audio.is_dir():
            for f in staged_audio.iterdir():
                if f.is_file():
                    shutil.move(str(f), str(live_audio / f.name))
                    restored_audio += 1

        return {
            "archive_path": str(archive_path),
            "pre_restore_path": str(pre_restore),
            "restored_audio": restored_audio,
            "created_at": manifest.get("created_at"),
        }
    finally:
        shutil.rmtree(staging, ignore_errors=True)
