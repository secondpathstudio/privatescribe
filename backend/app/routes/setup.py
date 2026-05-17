"""First-run setup: create the initial admin user.

Auth-free endpoints, but locked down to "no admin exists yet". Once the
app has any admin, /api/setup/create-admin returns 409 and is effectively
inert. Lets a packaged build bootstrap itself without shipping the Flask
CLI to end users.
"""
from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from werkzeug.security import generate_password_hash

from app.extensions import db, limiter
from app.models import User, Organization
from app.security import password_policy
from app.services.audit import log_action

bp = Blueprint("setup", __name__)


def _needs_setup() -> bool:
    """True when no admin user exists yet — the app is fresh."""
    return User.query.filter_by(role='admin').first() is None


@bp.route('/api/setup/status', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
def setup_status():
    """Unauthenticated probe so the login screen can flip to setup mode."""
    return jsonify({"needs_setup": _needs_setup()})


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

    if not email or '@' not in email:
        return jsonify({"error": "Valid email required"}), 400
    pw_err = password_policy.validate(password)
    if pw_err:
        return jsonify({"error": pw_err}), 400
    if not first_name or not last_name:
        return jsonify({"error": "First and last name required"}), 400
    if not organization:
        return jsonify({"error": "Organization name required"}), 400

    # Re-check after validation in case two setup requests raced.
    if not _needs_setup():
        return jsonify({"error": "Setup already complete"}), 409

    # The first-run admin and the install's organization are created
    # together — every user, starting with this admin, inherits the org.
    org = Organization(name=organization)
    db.session.add(org)
    db.session.flush()  # populates org.id

    admin = User(
        email=email,
        first_name=first_name,
        last_name=last_name,
        role='admin',
        password=generate_password_hash(password, method='pbkdf2:sha256'),
        last_login=None,
        organization_id=org.id,
    )
    db.session.add(admin)
    db.session.flush()  # populates admin.id
    log_action(
        'setup.create_admin',
        user_id=admin.id,
        user_email=admin.email,
    )
    db.session.commit()

    return jsonify({
        "id": admin.id,
        "email": admin.email,
        "organization": {"id": org.id, "name": org.name},
    }), 201
