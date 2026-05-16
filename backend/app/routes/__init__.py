"""Blueprint registry."""
from app.routes.auth import bp as auth_bp
from app.routes.setup import bp as setup_bp
from app.routes.users import bp as users_bp
from app.routes.admin_keys import bp as admin_keys_bp
from app.routes.admin_settings import bp as admin_settings_bp
from app.routes.admin_audit import bp as admin_audit_bp
from app.routes.notes import bp as notes_bp
from app.routes.templates import bp as templates_bp
from app.routes.participants import bp as participants_bp
from app.routes.transcription import bp as transcription_bp
from app.routes.transcription_live import bp as transcription_live_bp
from app.routes.two_factor import bp as two_factor_bp
from app.routes.user_settings import bp as user_settings_bp
from app.routes.onboarding import bp as onboarding_bp
from app.routes.roles import bp as roles_bp


def register_blueprints(app):
    app.register_blueprint(auth_bp)
    app.register_blueprint(setup_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(admin_keys_bp)
    app.register_blueprint(admin_settings_bp)
    app.register_blueprint(admin_audit_bp)
    app.register_blueprint(notes_bp)
    app.register_blueprint(templates_bp)
    app.register_blueprint(participants_bp)
    app.register_blueprint(transcription_bp)
    app.register_blueprint(transcription_live_bp)
    app.register_blueprint(two_factor_bp)
    app.register_blueprint(user_settings_bp)
    app.register_blueprint(onboarding_bp)
    app.register_blueprint(roles_bp)
