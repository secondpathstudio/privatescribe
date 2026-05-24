"""Production entrypoint for the embedded backend.

Used by:
- PyInstaller-bundled binaries spawned by Electron.
- Anyone running a non-debug server outside `flask run`.

Binds from the deployment mode: standalone stays loopback + free port (and
reports it to Electron over stdout); server binds all interfaces on a stable
port. PRIVATESCRIBE_HOST / PRIVATESCRIBE_PORT override either default.
"""
import socket

from waitress import serve

from app import create_app
from app.deployment import bind_host, configured_port, resolve_mode


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    mode = resolve_mode()
    host = bind_host(mode)
    # None means standalone with no explicit port — pick a free one so two
    # instances never collide, and report it to Electron below.
    port = configured_port(mode)
    if port is None:
        port = _pick_free_port()

    app = create_app()

    # Electron parses this line to learn the port. Keep the format stable.
    print(f"PRIVATESCRIBE_PORT={port}", flush=True)

    serve(app, host=host, port=port, threads=8)


if __name__ == "__main__":
    main()
