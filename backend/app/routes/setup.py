"""First-run setup: create the initial admin user.

Auth-free endpoints, but locked down to "no admin exists yet". Once the
app has any admin, /api/setup/create-admin returns 409 and is effectively
inert. Lets a packaged build bootstrap itself without shipping the Flask
CLI to end users.
"""
from flask import Blueprint, current_app, jsonify, request
from flask_cors import cross_origin
from werkzeug.security import generate_password_hash

from app.deployment import SERVER
from app.extensions import db, limiter
from app.models import User, Organization
from app.security import password_policy
from app.security.auth import _ADMIN_ROLES, ROLE_ADMIN, ROLE_SUPER_ADMIN
from app.services import settings as settings_service
from app.services.audit import log_action

bp = Blueprint("setup", __name__)


def _needs_setup() -> bool:
    """True when no admin-tier user exists yet — the app is fresh.

    Counts org-admins and super-admins alike, so a server bootstrapped with a
    super-admin (central IT) is correctly seen as already set up.
    """
    return User.query.filter(User.role.in_(_ADMIN_ROLES)).first() is None


@bp.route('/api/setup/status', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
def setup_status():
    """Unauthenticated probe so the login screen can flip to setup mode.

    Also reports no-login mode + the deployment mode so the login screen can
    decide whether to auto-sign-in (kiosk) instead of showing the password
    form, and so the admin UI can warn about no-login on a networked server.
    """
    return jsonify({
        "needs_setup": _needs_setup(),
        "no_login": settings_service.get_no_login_mode(),
        "deployment_mode": current_app.config.get("DEPLOYMENT_MODE", "standalone"),
    })


@bp.route('/api/setup/create-admin', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@limiter.limit("5 per minute")
def setup_create_admin():
    if not _needs_setup():
        return jsonify({"error": "Setup already complete"}), 409

    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    first_name = (data.get('firstName') or '').strip()
    last_name = (data.get('lastName') or '').strip()
    organization = (data.get('organization') or '').strip()
    no_login = bool(data.get('noLogin'))

    if not email or '@' not in email:
        return jsonify({"error": "Valid email required"}), 400
    pw_err = password_policy.validate(password)
    if pw_err:
        return jsonify({"error": pw_err}), 400
    if not first_name or not last_name:
        return jsonify({"error": "First and last name required"}), 400

    # In server mode the first-run admin is the super-admin (central IT): they
    # span organizations and create departments afterward, so they are org-less
    # and an org name is optional. Standalone keeps the single-org model where
    # the admin and the install's one organization are created together.
    is_server = current_app.config.get("DEPLOYMENT_MODE") == SERVER
    if not is_server and not organization:
        return jsonify({"error": "Organization name required"}), 400

    # Re-check after validation in case two setup requests raced.
    if not _needs_setup():
        return jsonify({"error": "Setup already complete"}), 409

    org = None
    if organization:
        org = Organization(name=organization)
        db.session.add(org)
        db.session.flush()  # populates org.id

    admin = User(
        email=email,
        first_name=first_name,
        last_name=last_name,
        role=ROLE_SUPER_ADMIN if is_server else ROLE_ADMIN,
        password=generate_password_hash(password, method='pbkdf2:sha256'),
        last_login=None,
        organization_id=org.id if org else None,
    )
    db.session.add(admin)
    db.session.flush()  # populates admin.id

    # Opt-in passwordless mode for a personal/home install: auto-sign-in as
    # this admin from now on. Server mode is multi-user and network-facing, so
    # the checkbox isn't offered there; ignore the flag defensively if it
    # somehow arrives. Admin areas still require the password (kiosk step-up).
    if no_login and not is_server:
        settings_service.set_value(
            settings_service.NO_LOGIN_MODE, True, updated_by=admin.id
        )
        settings_service.set_value(
            settings_service.NO_LOGIN_USER_ID, admin.id, updated_by=admin.id
        )

    log_action(
        'setup.create_admin',
        user_id=admin.id,
        user_email=admin.email,
        extra={'no_login': no_login and not is_server},
    )
    db.session.commit()

    return jsonify({
        "id": admin.id,
        "email": admin.email,
        "role": admin.role,
        "organization": {"id": org.id, "name": org.name} if org else None,
    }), 201
