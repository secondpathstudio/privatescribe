"""Encrypted audio file storage.

Audio uploads are encrypted at rest with a key derived from the SQLCipher
master key (HKDF, info=b"privatescribe-audio-v1"). The same backup that
protects the DB therefore protects the audio. If SQLCIPHER_KEY is rotated,
the derived audio key changes too — old files become unreadable. That's
acceptable because rotate_backup_key is a deliberate admin action that
already requires a re-encryption sweep of the DB; a future change can
extend that sweep to audio.

File layout (one file per upload):
    header  = magic(4) "PSAE" || version(1)=0x01 || nonce_prefix(8 random)
    chunks  = repeated [is_final(1)|length(4 BE)|ciphertext+tag(length)]

Each chunk's GCM nonce is nonce_prefix || chunk_index (4 BE), giving 12
bytes. is_final is bound into AAD so a truncation that drops the final
chunk fails authentication on the prior chunk. Reader stops after the
chunk with is_final=0x01.
"""
from __future__ import annotations

import logging
import os
import secrets
import struct
import uuid
from pathlib import Path
from typing import BinaryIO, Iterator

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.security import sqlcipher

MAGIC = b"PSAE"
VERSION = 1
HEADER_LEN = 4 + 1 + 8  # magic + version + nonce_prefix
CHUNK_SIZE = 64 * 1024  # plaintext bytes per chunk
TAG_LEN = 16
HKDF_INFO = b"privatescribe-audio-v1"

_state: dict[str, Path | None] = {"dir": None}


def configure(audio_dir: Path) -> None:
    """Called once from create_app() before first use."""
    audio_dir.mkdir(parents=True, exist_ok=True)
    _state["dir"] = audio_dir


def _audio_dir() -> Path:
    d = _state["dir"]
    if d is None:
        raise RuntimeError("audio_storage not configured")
    return d


def _derive_audio_key(master_hex: str) -> bytes:
    """Derive a 32-byte AES key from a SQLCipher master hex key via HKDF."""
    master = bytes.fromhex(master_hex)
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=HKDF_INFO,
    ).derive(master)


def _derive_key() -> bytes:
    """Derive a 32-byte AES key from the live SQLCipher hex key.

    Re-derived on every call rather than cached, so a runtime key rotation
    via /api/admin/rotate-backup-key is reflected immediately.
    """
    return _derive_audio_key(sqlcipher.current_key())


def _path_for(stored_filename: str) -> Path:
    # stored_filename is a UUID we generate; reject anything else to stop
    # path-traversal attempts via crafted DB rows.
    try:
        uuid.UUID(stored_filename)
    except ValueError as e:
        raise ValueError(f"invalid stored_filename: {stored_filename!r}") from e
    return _audio_dir() / stored_filename


def save_encrypted(src: BinaryIO) -> tuple[str, int]:
    """Encrypt `src` (a readable binary stream) to disk.

    Returns (stored_filename, plaintext_size_bytes). Caller is responsible
    for the AudioFile DB row. On any error mid-write the partial file is
    removed before the exception propagates.
    """
    key = _derive_key()
    aesgcm = AESGCM(key)
    nonce_prefix = secrets.token_bytes(8)
    stored_filename = str(uuid.uuid4())
    path = _path_for(stored_filename)

    plaintext_size = 0
    try:
        with open(path, "wb") as out:
            out.write(MAGIC)
            out.write(bytes([VERSION]))
            out.write(nonce_prefix)

            chunk_index = 0
            # Read-ahead by one chunk so we can mark the final chunk
            # without seeking. `pending` is the chunk we're about to write;
            # we hold it back until we've peeked at the next read.
            pending = src.read(CHUNK_SIZE)
            while True:
                next_chunk = src.read(CHUNK_SIZE)
                is_final = 0x01 if not next_chunk else 0x00
                aad = bytes([is_final])
                nonce = nonce_prefix + struct.pack(">I", chunk_index)
                ciphertext = aesgcm.encrypt(nonce, pending, aad)
                out.write(bytes([is_final]))
                out.write(struct.pack(">I", len(ciphertext)))
                out.write(ciphertext)

                plaintext_size += len(pending)
                chunk_index += 1
                if is_final:
                    break
                pending = next_chunk

            # Empty input edge case: nothing was ever read. Emit a single
            # final chunk with empty plaintext so reader contract holds.
            if chunk_index == 0:
                nonce = nonce_prefix + struct.pack(">I", 0)
                ciphertext = aesgcm.encrypt(nonce, b"", bytes([0x01]))
                out.write(bytes([0x01]))
                out.write(struct.pack(">I", len(ciphertext)))
                out.write(ciphertext)

        return stored_filename, plaintext_size
    except Exception:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def open_decrypted_stream(stored_filename: str) -> Iterator[bytes]:
    """Yield decrypted plaintext chunks for streaming back to a client.

    Authentication is per-chunk; a tampered or truncated file raises
    cryptography.exceptions.InvalidTag from inside the generator, which the
    caller should treat as a 500. Truncation is detectable because every
    non-final chunk's AAD says is_final=0 — losing the trailing chunk would
    leave the previous one's AAD mismatching the verifier.
    """
    path = _path_for(stored_filename)
    key = _derive_key()
    aesgcm = AESGCM(key)

    with open(path, "rb") as f:
        header = f.read(HEADER_LEN)
        if len(header) != HEADER_LEN or header[:4] != MAGIC:
            raise ValueError("audio file: bad magic")
        version = header[4]
        if version != VERSION:
            raise ValueError(f"audio file: unsupported version {version}")
        nonce_prefix = header[5:13]

        chunk_index = 0
        while True:
            flag_bytes = f.read(1)
            if not flag_bytes:
                raise ValueError("audio file: truncated (missing final chunk)")
            length_bytes = f.read(4)
            if len(length_bytes) != 4:
                raise ValueError("audio file: truncated chunk header")
            (length,) = struct.unpack(">I", length_bytes)
            if length < TAG_LEN:
                raise ValueError("audio file: chunk shorter than auth tag")
            ciphertext = f.read(length)
            if len(ciphertext) != length:
                raise ValueError("audio file: truncated chunk body")

            is_final = flag_bytes[0]
            nonce = nonce_prefix + struct.pack(">I", chunk_index)
            plaintext = aesgcm.decrypt(nonce, ciphertext, bytes([is_final]))
            if plaintext:
                yield plaintext
            chunk_index += 1
            if is_final == 0x01:
                return
            if is_final != 0x00:
                raise ValueError(f"audio file: bad is_final flag {is_final}")


def delete_file(stored_filename: str) -> None:
    """Remove an encrypted file. Silent if it's already gone."""
    path = _path_for(stored_filename)
    try:
        path.unlink(missing_ok=True)
    except OSError as e:
        # Logged but not raised — DB row deletion shouldn't be blocked by
        # filesystem state. An admin sweep can reconcile orphans.
        logger.error(f"audio_storage.delete_file({stored_filename}): {e}")


def file_exists(stored_filename: str) -> bool:
    return _path_for(stored_filename).exists()


# ---------------------------------------------------------------------------
# Key rotation
#
# rotate_backup_key in admin_keys.py drives a 3-phase re-encryption so audio
# files stay readable across a key change. Crash safety relies on:
#   1. Phase 1 (begin_reencryption) writes a `<uuid>.new` sibling for every
#      file, encrypted with the new master key. Originals are untouched.
#   2. The DB is then rekeyed via PRAGMA rekey. If that fails, the caller
#      runs rollback_reencryption to delete the .new siblings; the DB and
#      the originals are still on the old key, so the system is unchanged.
#   3. Phase 3 (commit_reencryption) atomically renames each .new over its
#      original via os.replace. If we crash after PRAGMA rekey but before
#      every rename completes, recover_pending_reencryption() at next boot
#      finishes the renames idempotently — at that point the live key is
#      already the new one and the surviving .new files are encrypted with
#      it, so swapping them in is the right move.
# ---------------------------------------------------------------------------

_NEW_SUFFIX = ".new"


def _is_uuid_name(name: str) -> bool:
    try:
        uuid.UUID(name)
        return True
    except ValueError:
        return False


def _stream_reencrypt(in_file: BinaryIO, out_file: BinaryIO,
                      old_aes: AESGCM, new_aes: AESGCM) -> None:
    """Read encrypted chunks from `in_file` (old key), write encrypted chunks
    to `out_file` (new key). Same chunk boundaries, fresh nonce_prefix.
    """
    header = in_file.read(HEADER_LEN)
    if len(header) != HEADER_LEN or header[:4] != MAGIC:
        raise ValueError("audio file: bad magic")
    if header[4] != VERSION:
        raise ValueError(f"audio file: unsupported version {header[4]}")
    old_nonce_prefix = header[5:13]

    new_nonce_prefix = secrets.token_bytes(8)
    out_file.write(MAGIC)
    out_file.write(bytes([VERSION]))
    out_file.write(new_nonce_prefix)

    chunk_index = 0
    while True:
        flag_bytes = in_file.read(1)
        if not flag_bytes:
            raise ValueError("audio file: truncated (missing final chunk)")
        length_bytes = in_file.read(4)
        if len(length_bytes) != 4:
            raise ValueError("audio file: truncated chunk header")
        (length,) = struct.unpack(">I", length_bytes)
        if length < TAG_LEN:
            raise ValueError("audio file: chunk shorter than auth tag")
        ciphertext = in_file.read(length)
        if len(ciphertext) != length:
            raise ValueError("audio file: truncated chunk body")

        is_final = flag_bytes[0]
        if is_final not in (0x00, 0x01):
            raise ValueError(f"audio file: bad is_final flag {is_final}")

        old_nonce = old_nonce_prefix + struct.pack(">I", chunk_index)
        plaintext = old_aes.decrypt(old_nonce, ciphertext, bytes([is_final]))

        new_nonce = new_nonce_prefix + struct.pack(">I", chunk_index)
        new_ct = new_aes.encrypt(new_nonce, plaintext, bytes([is_final]))
        out_file.write(bytes([is_final]))
        out_file.write(struct.pack(">I", len(new_ct)))
        out_file.write(new_ct)

        chunk_index += 1
        if is_final == 0x01:
            return


def begin_reencryption(old_master_hex: str, new_master_hex: str) -> list[Path]:
    """Phase 1: write a <uuid>.new sibling for every file, re-encrypted with
    the new key. Originals are not touched. Returns the list of original
    paths that have a .new sibling waiting; pass it to commit_reencryption
    or rollback_reencryption.
    """
    audio_dir = _audio_dir()
    old_aes = AESGCM(_derive_audio_key(old_master_hex))
    new_aes = AESGCM(_derive_audio_key(new_master_hex))

    completed: list[Path] = []
    in_progress_new: Path | None = None
    try:
        for path in sorted(audio_dir.iterdir()):
            if not path.is_file():
                continue
            if path.suffix == _NEW_SUFFIX:
                # Stale .new from an aborted prior run — drop it; we're about
                # to write a fresh one for the same original (if any).
                try:
                    path.unlink()
                except OSError:
                    pass
                continue
            if not _is_uuid_name(path.name):
                # Unrelated file in the audio dir; skip rather than fail.
                continue

            new_path = path.with_name(path.name + _NEW_SUFFIX)
            in_progress_new = new_path
            with open(path, "rb") as src, open(new_path, "wb") as dst:
                _stream_reencrypt(src, dst, old_aes, new_aes)
            in_progress_new = None
            completed.append(path)
        return completed
    except Exception:
        # Cleanup: drop the partial .new for the failing file plus all
        # already-prepared .new siblings. Originals are unchanged.
        if in_progress_new is not None:
            try:
                in_progress_new.unlink(missing_ok=True)
            except OSError:
                pass
        for p in completed:
            try:
                p.with_name(p.name + _NEW_SUFFIX).unlink(missing_ok=True)
            except OSError:
                pass
        raise


def commit_reencryption(originals: list[Path]) -> None:
    """Phase 3: atomically swap each <uuid>.new over <uuid> via os.replace.

    If a swap fails partway, the surviving .new files will be picked up by
    recover_pending_reencryption() on the next boot. The exception is
    re-raised after we've done everything we can.
    """
    first_error: Exception | None = None
    for p in originals:
        new_p = p.with_name(p.name + _NEW_SUFFIX)
        try:
            os.replace(new_p, p)
        except OSError as e:
            logger.error(f"audio_storage.commit_reencryption: replace {new_p} -> {p} failed: {e}")
            if first_error is None:
                first_error = e
    if first_error is not None:
        raise first_error


def rollback_reencryption(originals: list[Path]) -> None:
    """Drop .new siblings created by begin_reencryption. Safe to call even
    when commit was already run (it's a no-op then because the .new files
    are gone)."""
    for p in originals:
        new_p = p.with_name(p.name + _NEW_SUFFIX)
        try:
            new_p.unlink(missing_ok=True)
        except OSError as e:
            logger.error(f"audio_storage.rollback_reencryption: unlink {new_p} failed: {e}")


def recover_pending_reencryption() -> int:
    """Boot-time finisher: any leftover <uuid>.new file means a previous
    rotation crashed between PRAGMA rekey and the os.replace sweep. The
    live SQLCIPHER_KEY is now the new key, the .new file is encrypted with
    it, so atomically swapping it over the original completes the rotation.

    Returns the number of files swapped. Idempotent — running twice is a
    no-op the second time.
    """
    audio_dir = _state["dir"]
    if audio_dir is None or not audio_dir.exists():
        return 0
    swapped = 0
    for path in audio_dir.iterdir():
        if not path.is_file() or path.suffix != _NEW_SUFFIX:
            continue
        base = path.name[: -len(_NEW_SUFFIX)]
        if not _is_uuid_name(base):
            continue
        target = path.with_name(base)
        try:
            os.replace(path, target)
            swapped += 1
        except OSError as e:
            logger.error(f"audio_storage.recover_pending_reencryption: {path} -> {target} failed: {e}")
    if swapped:
        logger.info(f"audio_storage: recovered {swapped} pending re-encryption swap(s) on boot")
    return swapped
