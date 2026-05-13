"""Production entrypoint for the embedded backend.

Used by:
- PyInstaller-bundled binaries spawned by Electron.
- Anyone running a non-debug server outside `flask run`.

Picks a free port (or honors PRIVATESCRIBE_PORT), prints it to stdout
so the parent process can discover where to send API requests, then
serves the WSGI app via waitress.
"""
import os
import socket

from waitress import serve

from app import create_app


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    port_override = os.environ.get("PRIVATESCRIBE_PORT")
    port = int(port_override) if port_override else _pick_free_port()

    app = create_app()

    # Electron parses this line to learn the port. Keep the format stable.
    print(f"PRIVATESCRIBE_PORT={port}", flush=True)

    serve(app, host="127.0.0.1", port=port, threads=8)


if __name__ == "__main__":
    main()
