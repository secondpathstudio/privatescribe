"""Entrypoint for `flask run` and any WSGI server.

`.flaskenv` sets FLASK_APP=wsgi so the Flask CLI auto-discovers this module.
"""
from app import create_app
from app.deployment import debug_enabled

app = create_app()


if __name__ == '__main__':
    # debug defaults OFF (GAP-13): the Werkzeug debugger is an RCE/PHI-leak
    # footgun in production. Opt in with PRIVATESCRIBE_DEBUG=1 for local dev.
    app.run(host='127.0.0.1', port=5000, debug=debug_enabled())
