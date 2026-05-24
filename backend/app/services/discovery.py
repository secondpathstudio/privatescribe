"""Bonjour/mDNS service advertising for client auto-discovery (Phase 10).

In server mode the backend daemon advertises a ``_privatescribe._tcp`` service
on the LAN so a desktop client can list reachable servers and connect with one
click instead of typing an IP. The advertised port is Caddy's LAN (HTTPS) port —
the address clients actually connect to — not the backend's loopback port.

Best-effort and fully isolated: any failure (no LAN, multicast blocked, zeroconf
import error) is logged and swallowed so it can never take down the backend.
Discovery is a convenience; manual entry remains the fallback in the client UI.
"""
import logging
import socket

logger = logging.getLogger(__name__)

SERVICE_TYPE = "_privatescribe._tcp.local."

# Module-level so the registration lives for the process lifetime (the daemon
# runs until launchd stops it). Held only to unregister cleanly if asked.
_zeroconf = None
_service_info = None


def start_advertising(lan_port: int, name: str | None = None) -> bool:
    """Register the mDNS service for this server. Returns True if advertised.

    Idempotent-ish: a second call is a no-op while a registration is live.
    """
    global _zeroconf, _service_info
    if _zeroconf is not None:
        return True

    from app.services.net import lan_ip

    ip = lan_ip()
    if not ip:
        logger.info("mDNS advertising skipped: no LAN address found.")
        return False

    try:
        from zeroconf import ServiceInfo, Zeroconf
    except Exception as e:  # pragma: no cover - import guard
        logger.warning("mDNS advertising unavailable (zeroconf import failed): %s", e)
        return False

    hostname = socket.gethostname().split(".")[0] or "server"
    friendly = name or f"PrivateScribe ({hostname})"
    # Service instance names must be unique on the network; the hostname keeps
    # two servers on the same LAN from colliding.
    instance = f"{friendly}.{SERVICE_TYPE}"

    try:
        info = ServiceInfo(
            SERVICE_TYPE,
            instance,
            addresses=[socket.inet_aton(ip)],
            port=int(lan_port),
            # TXT record: a human label the client shows, and the login deep-link
            # path (a plain browser would otherwise land on the marketing page).
            properties={b"name": friendly.encode("utf-8"), b"path": b"/login"},
            server=f"{hostname}.local.",
        )
        zc = Zeroconf()
        zc.register_service(info)
        _zeroconf, _service_info = zc, info
        logger.info("mDNS advertising '%s' at %s:%s", friendly, ip, lan_port)
        return True
    except Exception as e:
        logger.warning("mDNS advertising failed: %s", e)
        return False


def stop_advertising() -> None:
    """Unregister and close. Safe to call when nothing is advertised."""
    global _zeroconf, _service_info
    if _zeroconf is None:
        return
    try:
        if _service_info is not None:
            _zeroconf.unregister_service(_service_info)
        _zeroconf.close()
    except Exception as e:  # pragma: no cover
        logger.warning("mDNS unregister failed: %s", e)
    finally:
        _zeroconf, _service_info = None, None
