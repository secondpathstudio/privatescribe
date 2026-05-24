"""Resolve the deployment mode (standalone | server | client).

PrivateScribe 2.0 runs one codebase in three roles, selected by the
``PRIVATESCRIBE_MODE`` environment variable:

- ``standalone`` — the default. Everything runs on one device, the backend is
  bound to loopback, SQLCipher SQLite. This is the shipping desktop app.
- ``server`` — the backend serves clients over the LAN.
- ``client`` — an Electron-only role that runs **no** Python backend (it talks
  to a remote server), so the backend never actually boots in this mode. It is
  part of the shared vocabulary, not a backend runtime mode.

Resolution **fails safe**: an unset, empty, or unrecognized value resolves to
``standalone`` — the most restrictive, loopback-only posture. A networked
deployment must opt in explicitly with ``PRIVATESCRIBE_MODE=server``, so a typo
or a stray ``client`` can never silently expose the backend on the network.
"""
import logging
import os

logger = logging.getLogger(__name__)

STANDALONE = "standalone"
SERVER = "server"
CLIENT = "client"

# Modes the Python backend can actually run as. `client` is intentionally
# excluded — a client has no backend process of its own.
_BACKEND_MODES = {STANDALONE, SERVER}

# Stable port the server binds when PRIVATESCRIBE_PORT isn't set — clients and
# the reverse proxy need a predictable target. Standalone instead picks a free
# port and reports it to Electron, so this default never applies there.
DEFAULT_SERVER_PORT = 5000

# The origin the standalone dev/Electron frontend calls from. Kept as the
# standalone default so today's app is unchanged.
DEFAULT_DEV_ORIGIN = "http://localhost:3000"


def resolve_mode() -> str:
    """Return the resolved backend deployment mode (``standalone`` or ``server``).

    Reads ``PRIVATESCRIBE_MODE`` and normalizes it. Anything that isn't a
    recognized backend mode — empty, a typo, or ``client`` (which has no
    backend) — falls back to ``standalone`` with a warning.
    """
    raw = (os.getenv("PRIVATESCRIBE_MODE") or "").strip().lower()
    if not raw:
        return STANDALONE
    if raw in _BACKEND_MODES:
        return raw
    logger.warning(
        "PRIVATESCRIBE_MODE=%r is not a backend mode; falling back to %r.",
        raw,
        STANDALONE,
    )
    return STANDALONE


def is_server(mode: str) -> bool:
    """True when running as the LAN-facing server."""
    return mode == SERVER


def is_standalone(mode: str) -> bool:
    """True when running as the single-device standalone app."""
    return mode == STANDALONE


def bind_host(mode: str) -> str:
    """Return the interface the backend should bind.

    ``PRIVATESCRIBE_HOST`` overrides everything (e.g. pin a specific LAN
    interface). Otherwise the server binds all interfaces so clients can reach
    it; standalone binds loopback only, matching today's behavior.
    """
    override = (os.getenv("PRIVATESCRIBE_HOST") or "").strip()
    if override:
        return override
    return "0.0.0.0" if is_server(mode) else "127.0.0.1"


def configured_port(mode: str) -> int | None:
    """Return the port to bind, or ``None`` to let the caller pick a free one.

    ``PRIVATESCRIBE_PORT`` wins when set. Otherwise the server uses the stable
    DEFAULT_SERVER_PORT (clients/proxy must find it), while standalone returns
    ``None`` so the entrypoint picks a free port and reports it to Electron.
    """
    override = (os.getenv("PRIVATESCRIBE_PORT") or "").strip()
    if override:
        return int(override)
    if is_server(mode):
        return DEFAULT_SERVER_PORT
    return None


def debug_enabled() -> bool:
    """Whether to run Flask's dev server with the interactive debugger.

    Defaults to **off**. The Werkzeug debugger exposes an RCE console and
    tracebacks that can leak PHI variable values, so it must never be on by
    accident — opt in explicitly with ``PRIVATESCRIBE_DEBUG=1`` for local dev.
    """
    raw = (os.getenv("PRIVATESCRIBE_DEBUG") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def cors_origins(mode: str) -> list[str]:
    """Return the allowed CORS origins.

    ``PRIVATESCRIBE_CORS_ORIGINS`` (comma-separated) overrides the default —
    that's how a server deployment whitelists its clients' origins. With
    nothing set, standalone trusts the local dev/Electron frontend, while a
    server denies all cross-origin requests until the operator configures it
    (same-origin requests, e.g. the frontend the server itself serves, never
    need CORS). Fail-safe: an unconfigured server is locked down, not open.
    """
    raw = (os.getenv("PRIVATESCRIBE_CORS_ORIGINS") or "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return [] if is_server(mode) else [DEFAULT_DEV_ORIGIN]
