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
