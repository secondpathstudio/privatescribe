# PrivateScribe Server — Install & Operations

> **Status:** Operator runbook — internal engineering reference.
> **Scope:** Standing up and running PrivateScribe in **server mode** on macOS,
> where one Mac hosts the app for a team and staff connect from their own
> devices over the LAN/VPN. For backup/restore specifics see
> [`backend/DISASTER_RECOVERY.md`](backend/DISASTER_RECOVERY.md).
> This is an operations guide, not legal advice.

---

## What server mode is

One Mac (the **server**) runs PrivateScribe for a single covered entity's
several departments/clinics; staff connect from their own desktops over the
**LAN or VPN** — never the public internet. The server is the same PrivateScribe
app installed in server mode; it runs three background services (macOS launchd
daemons) that survive logout and restart on crash:

| Service | Label | Role |
|---|---|---|
| Backend | `com.secondpath.privatescribe.backend` | Flask API + transcription, **loopback only** |
| Ollama | `com.secondpath.privatescribe.ollama` | local LLM, private loopback port |
| Caddy | `com.secondpath.privatescribe.caddy` | the only LAN-facing process — terminates TLS, serves the app, proxies `/api` to the backend |

Only Caddy listens on the network; the backend and Ollama bind loopback. PHI
never leaves the entity's network.

---

## Requirements

- **Apple Silicon Mac (M1 or later), macOS 13+.** (Apple-Silicon-only, like the
  desktop app.) A Mac Mini is a fine server.
- **Memory:** 16 GB is a comfortable baseline; the Whisper model and the Ollama
  model both sit in memory. Larger Whisper models (`medium`/`large-v3`) and
  larger LLMs want 32 GB.
- **GPU:** Apple Silicon's GPU accelerates Ollama automatically. Whisper runs on
  CPU (CTranslate2 has no Metal backend) — model size is the main speed lever.
- **Disk:** budget for the models (a few GB) plus stored audio over time.
- **Network:** a stable LAN address (a DHCP reservation or static IP) so the
  pairing URL doesn't change out from under clients.
- **Administrator access** on the Mac for the one-time install.

---

## Installing the server

1. Install the PrivateScribe app on the server Mac (drag to /Applications — keep
   it there; the services reference binaries inside the app bundle).
2. Launch it. On first run choose **"Set up a server."**
3. Confirm the HTTPS **port** (default `8443`).
4. Approve the **macOS administrator prompt** — this installs the three launchd
   daemons. (Installing system services requires admin; it's asked once.)
5. Create the **administrator account** (this is the super-admin / central IT —
   they manage departments and staff, and are not tied to one department).
6. Note the **pairing URL** shown (`https://<server-ip>:8443`). This is what
   staff enter in their PrivateScribe app.

After setup, the services run in the background; you can close the window or log
out and the server keeps serving.

---

## Where things live

| Item | Path |
|---|---|
| Data (DB, audio, `.env`, Caddy CA) | `/Library/Application Support/PrivateScribe/` |
| Rendered Caddy config | `/Library/Application Support/PrivateScribe/Caddyfile` |
| Logs | `/Library/Logs/PrivateScribe/{backend,ollama,caddy}.log` (+ `.err.log`) |
| Daemon definitions | `/Library/LaunchDaemons/com.secondpath.privatescribe.*.plist` |

Inspect a service (needs `sudo` for the system domain):

```bash
sudo launchctl print system/com.secondpath.privatescribe.backend
sudo launchctl kickstart -k system/com.secondpath.privatescribe.caddy   # restart one
tail -f /Library/Logs/PrivateScribe/backend.err.log
```

The admin console's **Server** page (super-admin only) shows live status —
connected clients, transcription model, last backup — without the CLI.

---

## Networking & client pairing

- Open the HTTPS port (default `8443`) to the LAN/VPN; do **not** expose it to
  the internet — that would change the compliance posture (see the HIPAA note
  below).
- The server uses a **self-signed certificate** from Caddy's internal CA. There
  is no public certificate authority, by design.
- On first connection each client confirms the server's certificate
  **fingerprint** (trust-on-first-use). That prompt is expected on a private
  network; after the first time the client remembers it.

---

## Backups

Backups cover the **whole server** (every department), and the `purge-*`
retention jobs run server-wide — both are central-IT actions. Schedule a backup
with a launchd timer or cron; it's safe to run while the server is serving.

```bash
# Daily 3:15 AM backup into /backups, keeping 30 days. Adjust the binary path
# to the installed backend, or run from a source checkout's venv.
15 3 * * *  /path/to/privatescribe-backend backup --out /backups --keep-days 30
```

**The key is not in the backup.** The archive is encrypted with `SQLCIPHER_KEY`
(in the data dir's `.env`); back that key up **separately** and store it apart
from the archives, or the backup is unrecoverable. Full detail and a tested
restore drill: [`backend/DISASTER_RECOVERY.md`](backend/DISASTER_RECOVERY.md).

> Restore is an **offline** operation — stop the services first
> (`sudo launchctl bootout system/com.secondpath.privatescribe.backend`), run
> `restore`, then start them again.

---

## Updates

The app auto-updates from the release channel. Because the daemons reference
binaries inside the `.app`, an update restarts the services after replacing the
bundle — keep the app in `/Applications` so the path stays stable. After a
major update, glance at the **Server** page to confirm the services are healthy.

---

## Security at rest

This is the SQLite tier: the database is encrypted with **SQLCipher** and audio
with **AES-256-GCM**, both keyed from `SQLCIPHER_KEY` in the data dir's `.env`
(the app's existing app-managed-key model — no separate volume encryption to
configure). Recommended hardening for a server box:

- Enable **FileVault** on the server Mac (protects the data dir + key if the
  disk is stolen).
- Restrict physical and login access to the server.
- Back up the key separately (above).

---

## Adding departments & staff

Sign in as the super-admin and use the admin console:

- **Organization → create** a department (clinic/unit).
- **Users** → add staff to a department, or an **org-admin** to manage that
  department's users. An org-admin sees and manages only their own department;
  the super-admin spans all. Emergency cross-department access goes through the
  audited **break-glass** path.

---

## HIPAA note

Hosting multiple departments of **one covered entity** over LAN/VPN keeps PHI
within that entity — no business-associate relationship, no vendor BAA. Exposing
the server to the public internet, or hosting **separate** organizations'
PHI on it, changes that analysis and is out of scope for this deployment model.

---

## Troubleshooting

- **A service won't start:** check `/Library/Logs/PrivateScribe/*.err.log`;
  re-run `sudo launchctl kickstart -k system/com.secondpath.privatescribe.<svc>`.
- **Clients can't connect:** verify the port is open to the LAN, the server's IP
  matches the pairing URL, and the client trusted the certificate fingerprint.
- **"Database is locked" / slowness under load:** the SQLite tier suits a small
  team; a larger deployment is the future Postgres tier (not yet shipped).
- **Lost the admin password:** recover at the machine with
  `flask reset-password --email …` (offline break-glass; needs the data dir key).
