# PrivateScribe 2.0.0 — Now for your whole team, on every platform

PrivateScribe is a fully local, private AI scribe. It records conversations, transcribes them, identifies speakers, and turns the transcript into the documents you actually need — entirely on your own machines. No accounts, no API keys, no telemetry, no cloud round-trips. The only network connection it ever makes is the one-time download of your local AI models.

Built for anyone whose conversations are too sensitive for the cloud.

**1.0 made that true for one person on one Mac. 2.0 makes it true for a whole team — and it now runs on Windows and Linux, too.**

---

## What's new in 2.0.0

### Server mode — run PrivateScribe for your whole team

Stand up one machine as a PrivateScribe server and let everyone connect from their own devices. The server does all the heavy lifting — recording, Whisper transcription, speaker diarization, and local LLM formatting — so individual workstations stay light.

- **Same friendly app, a different role.** There's nothing new to learn and no Docker stack to wrangle. Install the same PrivateScribe app, pick **"Set up a server"** on first run, and a setup wizard walks you through it. The app window becomes a status and admin control panel (think Plex or Tailscale), not the server itself.
- **It runs as a real background service.** Setup installs the backend, the local LLM (Ollama), and the web layer as OS background services (**launchd** on macOS, **Windows Services**, **systemd** on Linux). They survive logout, restart on crash, and keep serving with the window closed.
- **Stays on your network.** The server is reachable over your **LAN or VPN — never the public internet**. Only the TLS front door faces the network; the backend and the LLM bind to loopback and are never exposed. Your conversations and documents never leave your network.
- **Multiple users, departments, and roles.** A central administrator manages departments and staff; each person signs in with their own account and 2FA. Everything is still encrypted at rest on the server with SQLCipher.
- **Easy pairing.** Clients discover servers on the local network automatically, or you can connect with a simple pairing URL. The TLS certificate is pinned on first connection so subsequent logins are secure.

### Windows and Linux builds

PrivateScribe now ships as a real desktop app on **all three platforms** — and server mode works on each of them.

- **macOS** — Apple Silicon (arm64), signed and notarized.
- **Windows** — x64 installer and a no-install portable build.
- **Linux** — x64 AppImage and a `.deb` for Debian/Ubuntu.

### Smaller downloads, faster updates

- **Local AI models are fetched on first run** instead of being baked into the installer. Downloads are dramatically smaller and background auto-updates stay tiny.
- **Speaker diarization works fully offline out of the box** — the speaker model ships with the app, so there's no Hugging Face token and no extra setup. Diarization automatically uses your GPU when one is available and falls back to CPU cleanly.

---

## Everything from 1.0 is still here

### Capture & transcription
- Local Whisper transcription — pick the model size (tiny → large-v3) that fits your hardware.
- Real-time transcription with a live preview while you record.
- Speaker diarization (pyannote) — labels who said what; rename and reassign speakers by role or identity.
- Confidence highlighting — review and edit uncertain words before formatting.
- Custom vocabulary, abbreviations, and spoken dictation commands ("new paragraph", "period", …).
- System-audio + microphone capture for conference calls (desktop app).

### Formatting & documents
- Local LLM formatting via Ollama (defaults to Gemma 3) — the app manages the Ollama runtime for you, and reuses a running Ollama if you already have one.
- Customizable templates — define a document's structure once, apply it to any transcript.
- One recording, many documents — apply multiple templates to the same transcript and keep them linked; re-run a refined template without losing the old output.
- Note workflow: draft → finalized → signed, with immutable signed notes extended only via append-only addenda.
- PDF / DOCX export and full-text search across all notes.

### Security & privacy
- Encrypted at rest (SQLCipher) — transcripts, documents, templates, participants, and audio; runtime key rotation from the admin panel.
- Two-factor authentication (TOTP) with recovery codes; admins can require it org-wide.
- Brute-force lockout, configurable password policy, idle-timeout session controls.
- Tamper-evident, hash-chained audit log with admin-configurable retention and archival.
- Configurable audio storage and automatic retention/purge.

---

## Install

Grab the build for your platform from the assets below.

### macOS
Download `PrivateScribe-2.0.0-arm64.dmg`, open it, and drag PrivateScribe to Applications.

Requires Apple Silicon (M1 or newer). This release ships an Apple Silicon (arm64) build only. The app is signed and notarized.

### Windows (x64)
- **Installer:** `PrivateScribe Setup 2.0.0.exe` — a standard install wizard with a Start Menu entry and uninstaller.
- **Portable:** `PrivateScribe 2.0.0.exe` — a single executable, no install.

> **About the "unknown publisher" warning.** PrivateScribe is a free, open-source project, and this installer isn't code-signed with a paid certificate. So on first launch Windows SmartScreen may show a blue **"Windows protected your PC"** screen, and the install prompt may list the publisher as **"Unknown."** This is expected — it doesn't mean anything is wrong with the download. To continue, click **More info**, then **Run anyway**.
>
> If you'd rather verify before trusting it: everything PrivateScribe does runs locally on your machine, and the complete source code is public, so you can read exactly what you're installing — or build it yourself.

### Linux (x64)
- **AppImage:** `PrivateScribe-2.0.0.AppImage` — runs on most glibc-based distros. Mark it executable (`chmod +x`) and run it.
- **Debian/Ubuntu:** `privatescribe_2.0.0_amd64.deb` — `sudo apt install ./privatescribe_2.0.0_amd64.deb`.

### Running a server
Choose **"Set up a server"** on first launch on the machine that will host PrivateScribe, then follow the wizard. Operators can find a full setup-and-operations runbook in the docs.

---

## Updating from 1.x

Existing macOS installs update automatically — PrivateScribe checks GitHub Releases on launch and applies newer versions in the background. Your encrypted database carries forward; no migration steps are required.

> **Back up your `.env` separately from your database.** Your data is encrypted with a key stored in your `.env` file. Losing that file means the data can't be recovered — keep a backup somewhere safe and separate from the database itself.
