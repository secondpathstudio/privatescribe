from flask import jsonify


def register_error_handlers(app):
    @app.errorhandler(429)
    def ratelimit_handler(e):
        return jsonify({"error": "Too many requests. Please try again in a moment."}), 429
