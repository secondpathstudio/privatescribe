# Disaster Recovery — PrivateScribe.ai

> **Status:** Operator runbook — internal engineering reference.
> **Scope:** How to back up and recover the PrivateScribe database and audio.
> Covers the `flask backup` / `flask restore` commands and the key custody that
> makes recovery possible. This is an operations guide, not legal advice.

---

## TL;DR — the one thing that will ruin your day

**A backup archive is useless without the encryption key, and the key is not in
the archive.**

The database and audio are encrypted at rest with `SQLCIPHER_KEY`, which lives
in the `.env` file — **not** in the backup. If you lose `.env` and have no
separate copy of the key, the backup (and the live database) are
**permanently unrecoverable**. No vendor, no password reset, nothing.

So there are two things to back up, and they must be stored **separately**:

1. **The data** — produced by `flask backup` (encrypted DB + audio).
2. **The key** — the `.env` file, or at minimum its `SQLCIPHER_KEY` value.

Storing the key next to the encrypted data defeats the encryption. Keep the
key in a password manager or a sealed offline copy, in a different place from
the archives.

---

## What a backup contains (and what it doesn't)

`flask backup` writes a single `.tar.gz` containing:

- `privatescribe.db` — a consistent snapshot of the encrypted database, taken
  with `VACUUM INTO` (safe to run while the server is serving; no downtime).
- `audio/…` — the AES-256-GCM-encrypted audio recordings.
- `manifest.json` — a SHA-256 checksum and size for every file, used to verify
  integrity on restore.

Both the DB and the audio are **already ciphertext**, so the archive carries no
plaintext PHI. It is safe to store on ordinary backup media — but, again, it is
worthless without the separately-stored key.

It does **not** contain: `.env`, `SQLCIPHER_KEY`, `JWT_SECRET_KEY`, or
`AUDIT_HMAC_KEY`. Back those up yourself (see *Key custody* below).

**Scope — whole server.** On a multi-tenant server (one covered entity's
several departments/orgs), a backup is the *entire* database and audio store,
spanning every organization — there is no per-department backup. Likewise the
`purge-*` retention jobs run operator-wide across all orgs. Both are
central-IT actions, by design.

---

## Taking backups

Run from the `backend/` directory with the virtualenv active (`FLASK_APP=wsgi`
is set in `.flaskenv`):

```bash
# One-off backup to an explicit file
flask backup --out /backups/privatescribe-2026-05-24.tar.gz

# Backup into a directory: auto-names privatescribe-backup-<UTC>.tar.gz
flask backup --out /backups

# Database only, skip audio (smaller / faster)
flask backup --out /backups --no-audio
```

The command prints the archive path, its size, the audio count, and the
archive's SHA-256.

### Scheduling (the part that makes it a real backup plan)

Run it on a timer, alongside the existing `purge-*` jobs. When `--out` is a
**directory**, old archives are pruned automatically per the retention window:

- `backup_retention_days` (admin setting; default `0` = keep forever), or
- `--keep-days N` on the command (overrides the setting).

Only the app's own `privatescribe-backup-*.tar.gz` files are ever pruned —
other files in the directory are left untouched.

Example daily cron (3:15 AM), keeping 30 days:

```cron
15 3 * * *  cd /opt/privatescribe/backend && /opt/privatescribe/backend/venv/bin/flask backup --out /backups --keep-days 30
```

A backup you have never restored is a hope, not a plan — see *Verifying a
backup* below.

---

## Restoring

> **Stop the server first**, and restart it afterward. Restore swaps the
> database file on disk; doing that under a running server is unsafe.

```bash
flask restore /backups/privatescribe-backup-20260524T031500Z.tar.gz
```

Before it changes anything, restore:

1. Verifies every file's checksum against the manifest (aborts if corrupt).
2. Confirms the snapshot **decrypts with the current `SQLCIPHER_KEY`** (aborts
   if the key doesn't match — see below). This is why the matching `.env` must
   be in place *before* you restore.

Only after both checks pass does it touch the live data — and even then it
**moves the current DB and audio aside** into a timestamped
`pre-restore-<UTC>/` folder in the data directory rather than deleting them. A
mistaken restore is recoverable.

If a database already exists, restore refuses unless you pass `--force` (the
existing data is still moved aside, not deleted):

```bash
flask restore <archive> --force
```

After restore completes, **restart the server** to pick up the restored
database.

### "Does not open with the current SQLCIPHER_KEY"

This means the archive was encrypted with a different key than the one in your
current `.env` — e.g. you're restoring onto a fresh machine, or after a key
rotation. Put the **matching** key/`.env` in place first, then re-run restore.
Nothing was changed.

---

## Key custody

The keys live in `.env` in the data directory (see *Where files live*). The
critical one is `SQLCIPHER_KEY`; `AUDIT_HMAC_KEY` is needed to verify the audit
hash chain, and `JWT_SECRET_KEY` signs sessions. **Back up the whole `.env`.**

- Store it in a password manager and/or a sealed offline copy.
- Store it **separately** from the data archives.
- **Key rotation:** rotating `SQLCIPHER_KEY` (via the admin "rotate backup key"
  flow) re-encrypts the live data with a new key. Archives taken *before* the
  rotation still require the *old* key to restore — keep old keys until the
  archives they match have aged out.

---

## Verifying a backup (the restore drill)

Periodically prove a backup actually restores — into a throwaway location, so
you never touch production:

```bash
# 1. Point a scratch data dir at a copy of the matching .env (key must match!)
export PRIVATESCRIBE_DATA_DIR=/tmp/ps-restore-test
mkdir -p "$PRIVATESCRIBE_DATA_DIR"
cp /secure/backup-of/.env "$PRIVATESCRIBE_DATA_DIR/.env"

# 2. Restore the archive into it
flask restore /backups/<archive>.tar.gz --force

# 3. Boot against it and confirm the data is there
flask shell <<'PY'
from app.models import Note, User
print("users:", User.query.count(), "notes:", Note.query.count())
PY

# 4. Tear it down
rm -rf "$PRIVATESCRIBE_DATA_DIR"
unset PRIVATESCRIBE_DATA_DIR
```

If step 3 shows your expected data, the archive **and** the key are good. Do
this on a schedule (e.g. monthly) and after any key rotation.

---

## Where files live

| Item | Developer (`flask run`) | Packaged / data-dir mode |
|---|---|---|
| Database | `backend/instance/privatescribe.db` | `$PRIVATESCRIBE_DATA_DIR/privatescribe.db` |
| Audio | `backend/instance/audio/` | `$PRIVATESCRIBE_DATA_DIR/audio/` |
| Keys | `backend/.env` | `$PRIVATESCRIBE_DATA_DIR/.env` |

In packaged/server mode, `PRIVATESCRIBE_DATA_DIR` relocates all three into one
user-writable directory outside the read-only app bundle — that one directory
(plus the separately-stored key) is the whole recovery story.

> **Packaged server note:** `flask backup` / `flask restore` are Flask CLI
> commands, available directly in a source deployment. On a packaged server
> they are exposed through the bundled backend's management entrypoint —
> wiring finalized as part of the server-mode work (roadmap Phase 9).

---

## Quick reference

```bash
flask backup  --out <file|dir> [--no-audio] [--keep-days N]   # create archive
flask restore <archive> [--force]                              # restore archive
```

- Backup is safe while serving; **restore requires the server stopped**.
- The archive is encrypted; the key (`.env`) is **not** in it — store it apart.
- Restore verifies checksums + key, then moves current data to `pre-restore-*`.
