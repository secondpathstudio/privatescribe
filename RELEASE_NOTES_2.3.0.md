# PrivateScribe 2.3.0 — Your recording survives anything

A crash, a reload, a force-quit, a laptop dying mid-consult — until now, any of those could take an in-progress recording with it. Not anymore.

---

## What's new in 2.3.0

### Crash-durable recordings

Recordings used to live only in memory until you pressed Stop. As of 2.3.0, every chunk of audio is saved to disk **as it's recorded**, so if anything interrupts a session — a crash, an accidental tab reload, a power cut — you lose at most the last ~2 seconds, not the whole consult.

- **Automatic recovery.** The next time you open the new-note page, a banner offers any unsaved recording back: transcribe it into a note, or discard it. Nothing to configure, nothing to dig for.
- **Encrypted before it ever touches disk.** Buffered audio is AES-256-GCM encrypted with a per-user key before it's written — plaintext audio never lands in the app's profile directory. The key is derived from the same master key that encrypts your database, is handed out only to your authenticated session, and every issuance is recorded in the audit log.
- **Key rotation stays safe.** If an admin rotates the master encryption key, any audio buffered under the old key is clearly reported as unrecoverable — it's never silently decrypted to garbage.
- **Zero risk to the recording itself.** The durability layer is strictly best-effort: if it can't run (and there's no plaintext fallback — encryption is mandatory), recording simply behaves exactly as it did before.
- **Self-cleaning.** Recovered audio is removed once its note is actually saved, and anything left unclaimed is purged after 7 days.

---

## Install & update

If you're already on 2.x, the app will update itself automatically. New installs: download `PrivateScribe-2.3.0-arm64.dmg` from the assets below, open it, and drag PrivateScribe to Applications (Apple Silicon, signed and notarized).

As always: fully local, no accounts, no cloud, no telemetry. Your conversations never leave your machines.
