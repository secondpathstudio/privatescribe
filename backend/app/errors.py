from flask import current_app, jsonify


def register_error_handlers(app):
    @app.errorhandler(429)
    def ratelimit_handler(e):
        return jsonify({"error": "Too many requests. Please try again in a moment."}), 429

    @app.errorhandler(413)
    def request_entity_too_large(e):
        # Flask raises this when the multipart body exceeds MAX_CONTENT_LENGTH
        # (set by /api/admin/settings/upload-limit-mb at runtime).
        max_bytes = current_app.config.get('MAX_CONTENT_LENGTH') or 0
        max_mb = max_bytes // (1024 * 1024) if max_bytes else None
        return jsonify({
            "error": "file_too_large",
            "message": (
                f"That file is larger than the {max_mb} MB upload limit. "
                "Try a shorter clip, compress the audio, or ask an admin to raise the limit."
                if max_mb
                else "That file is too large to upload."
            ),
            "max_mb": max_mb,
        }), 413
