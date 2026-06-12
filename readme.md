# PrivateScribe

**An open-source AI scribe that never sends your conversations anywhere.**

Transcription and structured note generation built for clinicians, attorneys, therapists, and anyone whose conversations are too sensitive for the cloud. Audio is captured, transcribed, and formatted into the documents you actually need — SOAP notes, intake summaries, session notes, interview records — entirely on your own machine.

No API keys. No accounts. No telemetry. No cloud round-trips. The only network connection PrivateScribe ever needs is the one-time download of your local AI models.

---

## Why this exists

Most AI scribes send your audio and notes to someone else's servers. That's a problem if you're a physician, therapist, or attorney handling things that shouldn't leak.

PrivateScribe runs everything on your own machine. Speech-to-text, language model, and storage all stay local. Pull the network cable and it keeps working.

Templates turn raw transcripts into the documents you actually need — SOAP notes, intake summaries, session notes, whatever shape your work requires. Define the structure once, apply it to any conversation.

One recording can produce many documents. Apply several templates to the same transcript and get a SOAP note, a patient summary, and a billing extract side by side. Refine a template and re-run it: the new output is added without overwriting the old one.

---

## Who it's for

- **Physicians and other clinicians** who want their notes generated without sending PHI through a third party
- **Therapists and counselors** documenting sessions where confidentiality is the entire point
- **Attorneys** capturing client interviews, depositions, and privileged conversations
- **Researchers** conducting interviews under IRB protocols that prohibit cloud processing
- **Anyone** who would rather their private conversations stay private

---

## What it does today

**Capture and transcription**

- **Whisper-based transcription** running locally — no audio leaves your machine. Pick the model size (`tiny` → `large-v3`) that fits your hardware.
- **Real-time transcription** — see a live preview while you record, not just after you stop.
- **Speaker diarization** — pyannote labels who said what, so conversations come out as a readable, attributed transcript complete with ability to name speakers by role or identity.
- **Confidence highlighting** — words Whisper was unsure about are flagged so you can review, edit, and approve a transcript before formatting.
- **Custom vocabulary, abbreviations, and dictation commands** — bias transcription toward your domain terms, auto-expand short forms, and speak formatting commands like "new paragraph" or "period".

**Formatting and documents**

- **Local LLM formatting** via Ollama (defaults to Gemma 3, swap in any model you prefer). The desktop app bundles the Ollama runtime — if you already are running an Ollama server, PrivateScribe will use it instead.
- **Customizable templates** — simple Markdown templates (or structured templates imported from the Studio - coming soon). Define the document structure once, apply it to any transcript.
- **One transcript, many documents** — apply multiple templates to the same recording and keep them linked as siblings of a single source. Refine a template, re-run it, get a new sibling without losing the old one.
- **Note workflow** — notes move draft → finalized → signed. Signed notes are immutable and extended only through append-only addenda.
- **Document export** — download finished notes as PDF or DOCX (admins can disable export org-wide).
- **Full-text search** across all of your notes.

**Security and privacy**

- **Encrypted at rest** — transcripts, generated documents, templates, participant records, and the original audio recordings are all stored encrypted on disk. The encryption key can be rotated at runtime from the admin panel.
- **Configurable audio storage** — admins choose whether recordings are kept at all and, if so, for how long before they're automatically purged.
- **Two-factor authentication** — optional TOTP for every user, with one-time recovery codes; admins can require it org-wide and reset it for a user who has lost their device.
- **Brute-force protection** — after too many consecutive failed sign-in attempts an account is temporarily locked; the attempt threshold and lockout duration are admin-configurable, and an admin can unlock an account early.
- **Password policy** — an admin-selected strength policy (standard or strict) enforced consistently on every path that sets a password.
- **Session controls** — a configurable idle-timeout that signs inactive users out, plus an option for the desktop app to forget credentials on close.
- **Tamper-evident audit logging** — security-relevant actions (logins, key access, deletions, admin changes) are recorded in an append-only, hash-chained audit log with an admin-configurable retention and archival policy.
- **Offline account recovery** — break-glass CLI commands reset a forgotten password or clear a lockout with no email server or cloud round-trip, so even a sole admin can never be permanently locked out.

**Everything else**

- **Participant and role management** — track who was in the conversation and have templates use that context; custom roles also scope which shared templates each user sees.
- **Soft-delete with retention** — deleted notes and templates go to a trash and are recoverable, with an admin-configured retention window before they can be permanently purged.
- **Guided first-run setup** — an onboarding wizard walks a new install through creating the admin account, picking models, and seeding starter templates.
- **Runs as a desktop app or in the browser** — a signed, notarized macOS build, or the standard web app.
- **Fully offline operation** after the initial model download.
- **MIT licensed** — fork it, audit it, modify it, ship it inside your own workflow.

---

## How it works

```
   ┌─────────────┐      ┌──────────────┐      ┌──────────────┐
   │  Microphone │ ───▶ │   Whisper    │ ───▶ │  Raw         │
   │             │      │ (local)      │      │  transcript  │
   └─────────────┘      └──────────────┘      └──────┬───────┘
                                                     │
                                  ┌──────────────────┼──────────────────┐
                                  ▼                  ▼                  ▼
                          ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
                          │  Template A  │   │  Template B  │   │  Template C  │
                          │  + Ollama    │   │  + Ollama    │   │  + Ollama    │
                          └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
                                 ▼                  ▼                  ▼
                          ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
                          │  SOAP note   │   │  Patient     │   │  Billing     │
                          │              │   │  summary     │   │  extract     │
                          └──────────────┘   └──────────────┘   └──────────────┘
                                          (all siblings, linked
                                           to the same transcript)
```

Audio in -> local transcription -> transcript becomes the canonical source. Apply any template — or several — to produce structured documents, all preserved as a tree under their parent recording. Nothing in the middle ever touches an outside network.

---

## Threat model

Honest disclosure of what PrivateScribe protects against and what it doesn't:

**What stays local:** All audio. All transcripts. All generated documents. All template definitions. All participant records.

**The single network exception:** The first time you download an AI model, that download happens over the internet. After that, you can disconnect entirely and everything will keep working - forever. If you want to update your model or pull a different one, you'll need to reconnect temporarily. You could also do this on a different machine, transfer the model files via USB, and load them locally if you want to avoid any network connection at all.

**What this is *not*:** A HIPAA compliance certification. HIPAA compliance is an organizational and procedural matter, not a software feature. PrivateScribe gives you the *technical* foundation a covered entity would need (data never leaves the device, no third-party processors involved), but the policies, BAAs, audit procedures, and risk assessments remain your responsibility.

**Encryption at rest.** The database is encrypted with SQLCipher (256-bit key), and the original audio recordings are encrypted with AES-256-GCM using a key derived from the SQLCipher master via HKDF. The SQLCipher key is auto-generated on first run and stored in `backend/.env` (chmod 600). Admins can view the key after re-authenticating and rotate it at runtime from the admin panel — rotation re-encrypts the database and audio files together as one coordinated sweep, and every key access writes an audit-log entry.

**What this protects against — and what it doesn't.** App-layer encryption matters when the data files and the key get separated: backups that travel without `.env`, recovered disk sectors after deletion, accidental cloud syncs, or another OS user on a multi-user machine. It does **not** protect against an attacker who has full local access to your running machine — `.env` is right there. For that threat, **full-disk encryption is non-negotiable**: FileVault on macOS, BitLocker on Windows, LUKS on Linux, with the device locked or powered off when not in use. Treat PrivateScribe's app-layer encryption as defense in depth on top of FDE, not a replacement for it.

---

## Tech stack

- **Backend:** Flask + SQLAlchemy + SQLite (SQLCipher)
- **Frontend:** Vite + React + TypeScript
- **Desktop app:** Electron (bundles the backend, frontend, and Ollama runtime)
- **Transcription:** Whisper (faster-whisper)
- **Speaker diarization:** pyannote.audio
- **LLM inference:** Ollama
- **Auth:** JWT with admin-created accounts, optional TOTP two-factor
- **Encryption:** SQLCipher (database) + AES-256-GCM (audio)

---

## Getting started

### Prerequisites

- Python 3.8+
- Node.js 16+
- [Ollama](https://ollama.ai/) installed and running

### Install

```bash
git clone https://github.com/secondpathstudio/privatescribe.git
cd privatescribe
```

**Backend** (from `backend/`):

```bash
cd backend
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
flask db upgrade
```

You also need SQLCipher installed on the host (`brew install sqlcipher` on macOS).

**Frontend** (from `frontend/`):

```bash
cd frontend
npm install
```

**Pull a model with Ollama:**

```bash
ollama pull gemma3:4b
```

**Optional — speaker diarization:** to label who said what, set `HF_TOKEN` in `backend/.env` (a Hugging Face access token, used once to download the pyannote model). Without it, transcription still works — it just won't separate speakers.

### Run

Start the backend (from `backend/`):

```bash
source venv/bin/activate
flask run
```

The backend listens on `http://127.0.0.1:5000`. A unique JWT secret is generated on first run and saved to `backend/.env`.

Create your admin user — open the app and complete the first-run setup screen or run this command from `backend/`:

```bash
flask create-admin
```

On first admin login, the database encryption key will be displayed once. **Record it in a secure location** (a password manager is the right tool here). It will remain accessible to any admin after password re-authentication, and can be reset from the admin panel if necessary.

Because PrivateScribe has no mail server, account recovery is a local, break-glass operation. If anyone forgets their password — or an account is locked after too many failed sign-ins — run `flask reset-password --email <address>` or `flask unlock-account --email <address>` from `backend/`. This works even for a sole admin who would otherwise have no way back in.

Start the frontend (from `frontend/`):

```bash
npm run dev
```

The dashboard opens at `http://127.0.0.1:3000`.

### Desktop app

A signed, notarized macOS build will be available soon; Windows and Linux installers are on the roadmap.

---

## Templates and the document tree

A template is a structured prompt that tells the LLM how to transform a raw transcript into a finished document. Templates are stored as data — you can author them in the UI, version them, share them, and apply different templates to the same recording.

The data model is built around a simple idea: **the recording and its transcript are the canonical source, and every formatted document is a derivative of it.** When you apply a template to a transcript, the resulting document is stored as a child of that transcript. Apply a second template — for a different audience, a different purpose, a different format — and you get a sibling. Refine a template later and re-run it, and the new output is added as another sibling without disturbing the old one.

This means:

- Your raw transcript is never overwritten by formatting work
- A single visit, session, or interview can produce as many parallel documents as you need
- Iterating on a template is non-destructive — past outputs are preserved alongside new ones
- Provenance is built in: every document carries a clear link to the source it was derived from and the template that produced it

PrivateScribe is general enough to handle any domain where structured documentation matters — medicine, law, counseling, journalism, qualitative research.

---

## Long-term Roadmap

- Guided backup & restore so losing `backend/.env` can't brick the database
- Windows and Linux desktop installers (`.exe`, `.AppImage`) — a signed macOS build ships today
- On-prem server mode: one office server hosting the backend, Whisper, and Ollama for desktops, tablets, and phones on a closed LAN, with TLS by default
- Phone-as-microphone — record on a phone, review and edit on the desktop
- Storage panel in settings: show how much disk the app is using by category (database, Whisper model cache, downloaded LLMs) with per-category cleanup — plus an uninstall-time "remove my data too?" prompt on Windows

---

## Contributing

Issues and pull requests welcome. If you're a domain expert (clinician, attorney, therapist) and want to contribute templates or feedback on what would actually be useful, that's especially valuable — the engineering side of this project benefits enormously from people who write these notes for a living.

---

## License

MIT. See [license.txt](license.txt).

---