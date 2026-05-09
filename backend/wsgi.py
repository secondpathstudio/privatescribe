"""Entrypoint for `flask run` and any WSGI server.

`.flaskenv` sets FLASK_APP=wsgi so the Flask CLI auto-discovers this module.
"""
from app import create_app

app = create_app()


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
