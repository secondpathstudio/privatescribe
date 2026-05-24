"""Small network helpers shared across the app (Phase 9/10).

Kept dependency-free and side-effect-free so routes and services can both use
them without importing one another.
"""
import socket


def lan_ip() -> str | None:
    """Best-effort LAN IPv4 of this host.

    Primary: the address of the default-route interface (a UDP ``connect`` picks
    it without sending any packets — works on a routed LAN with no internet).
    Falls back to hostname resolution. Returns None if only loopback is found.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        if ip and not ip.startswith("127."):
            return ip
    except OSError:
        pass
    finally:
        s.close()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass
    return None
