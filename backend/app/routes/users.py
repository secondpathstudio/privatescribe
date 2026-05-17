from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required
from werkzeug.security import check_password_hash, generate_password_hash

from app.extensions import db, limiter
from app.models import Organization, Role, User
from app.security import sessions
from app.security.auth import require_admin
from app.services import two_factor
from app.services.audit import log_action

bp = Blueprint("users", __name__)

# Modest cap; align with the login flow's brute-force defense. Anything
# stricter and a fat-fingered user gets locked out of their own change form.
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 256


def _validate_new_password(value) -> str | None:
    """Returns an error message if invalid, else None."""
    if not isinstance(value, str) or not value:
        return "newPassword is required"
    if len(value) < PASSWORD_MIN_LENGTH:
        return f"Password must be at least {PASSWORD_MIN_LENGTH} characters"
    if len(value) > PASSWORD_MAX_LENGTH:
        return f"Password must be {PASSWORD_MAX_LENGTH} characters or fewer"
    return None


@bp.route('/api/getAllUsers', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def get_all_users():
    users = User.query.all()
    if not users:
        return jsonify({"error": "No users found"}), 404

    users_list = [{
        "id": user.id,
        "email": user.email,
        "firstName": user.first_name,
        "lastName": user.last_name,
        "role": user.role,
        "createdAt": user.created_at,
        "lastLogin": user.last_login,
        "twoFactorEnrolled": two_factor.is_enrolled(user),
        "isActive": user.is_active,
        "roles": [{"id": r.id, "name": r.name} for r in user.roles],
        "organization": (
            {"id": user.organization.id, "name": user.organization.name}
            if user.organization else None
        ),
    } for user in users]

    return jsonify(users_list)


@bp.route('/api/admin/users', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def admin_create_user():
    data = request.get_json(silent=True) or {}

    required = ('firstName', 'lastName', 'email', 'password')
    if not all(data.get(k) for k in required):
        return jsonify({"error": "firstName, lastName, email, and password are required"}), 400

    role = data.get('role', 'user')
    if role not in ('user', 'admin'):
        return jsonify({"error": "Invalid role"}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({"error": "User email already exists"}), 400

    # New users inherit the install's organization (one org per install).
    org = Organization.query.first()

    new_user = User(
        first_name=data['firstName'],
        last_name=data['lastName'],
        email=data['email'],
        role=role,
        password=generate_password_hash(data['password'], method='pbkdf2:sha256'),
        last_login=None,
        organization_id=org.id if org else None,
    )
    db.session.add(new_user)
    db.session.flush()
    log_action(
        'admin.user_create',
        user_id=get_jwt_identity(),
        resource_type='user',
        resource_id=new_user.id,
        extra={
            'target_email': new_user.email,
            'target_role': new_user.role,
        },
    )
    db.session.commit()

    return jsonify({
        "id": new_user.id,
        "email": new_user.email,
        "firstName": new_user.first_name,
        "lastName": new_user.last_name,
        "role": new_user.role,
        "createdAt": new_user.created_at,
        "lastLogin": new_user.last_login,
        "isActive": new_user.is_active,
        "roles": [],
        "organization": (
            {"id": org.id, "name": org.name} if org else None
        ),
    }), 201


@bp.route('/api/me/change-password', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
@limiter.limit("10 per minute")
def change_own_password():
    """Self-service password change. Requires current password as proof-of-identity
    so a stolen access token alone can't pivot to permanent account takeover.
    Clears force_password_change on success."""
    data = request.get_json(silent=True) or {}
    current_password = data.get('currentPassword')
    new_password = data.get('newPassword')

    if not current_password:
        return jsonify({"error": "currentPassword is required"}), 400
    err = _validate_new_password(new_password)
    if err:
        return jsonify({"error": err}), 400
    if new_password == current_password:
        return jsonify({"error": "New password must differ from current password"}), 400

    user = User.query.get(get_jwt_identity())
    if not user:
        return jsonify({"error": "User not found"}), 404
    if not check_password_hash(user.password, current_password):
        log_action(
            'user.password_change',
            user_id=user.id,
            user_email=user.email,
            status='failure',
            extra={'reason': 'invalid_current_password'},
        )
        db.session.commit()
        return jsonify({"error": "Current password is incorrect"}), 401

    user.password = generate_password_hash(new_password, method='pbkdf2:sha256')
    user.force_password_change = False
    log_action(
        'user.password_change',
        user_id=user.id,
        user_email=user.email,
    )
    db.session.commit()
    return jsonify({"message": "Password updated"}), 200


@bp.route('/api/admin/users/<string:user_id>/reset-password', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
@limiter.limit("10 per minute")
def admin_reset_password(user_id):
    """Admin sets another user's password. Requires the admin's own password as
    re-auth so a stolen admin token can't silently rewrite credentials. The
    target user is flagged force_password_change so they must rotate the
    admin-chosen password the next time they log in."""
    data = request.get_json(silent=True) or {}
    admin_password = data.get('adminPassword')
    new_password = data.get('newPassword')

    if not admin_password:
        return jsonify({"error": "adminPassword is required"}), 400
    err = _validate_new_password(new_password)
    if err:
        return jsonify({"error": err}), 400

    admin_id = get_jwt_identity()
    if admin_id == user_id:
        # Admins must use /api/me/change-password for their own account so the
        # force-rotate flag isn't applied to themselves.
        return jsonify({"error": "Use /api/me/change-password to change your own password"}), 400

    admin = User.query.get(admin_id)
    if not admin or not check_password_hash(admin.password, admin_password):
        log_action(
            'admin.password_reset',
            user_id=admin_id,
            user_email=admin.email if admin else None,
            resource_type='user',
            resource_id=user_id,
            status='failure',
            extra={'reason': 'invalid_admin_password'},
        )
        db.session.commit()
        return jsonify({"error": "Admin password is incorrect"}), 401

    target = User.query.get(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404

    target.password = generate_password_hash(new_password, method='pbkdf2:sha256')
    target.force_password_change = True
    log_action(
        'admin.password_reset',
        user_id=admin.id,
        user_email=admin.email,
        resource_type='user',
        resource_id=target.id,
        extra={'target_email': target.email},
    )
    db.session.commit()
    return jsonify({
        "message": "Password reset. User must change it on next login.",
        "userId": target.id,
        "forcePasswordChange": True,
    }), 200


@bp.route('/api/admin/users/<string:user_id>/reset-2fa', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
@limiter.limit("10 per minute")
def admin_reset_2fa(user_id):
    """Admin clears another user's TOTP secret and recovery codes. Used when
    a user has lost both their phone and their recovery codes. Requires the
    admin's own password as re-auth so a stolen admin token can't silently
    strip a second factor. If the system-wide toggle is on, the target user
    is forced through enrollment on their next login."""
    data = request.get_json(silent=True) or {}
    admin_password = data.get('adminPassword')
    if not isinstance(admin_password, str) or not admin_password:
        return jsonify({"error": "adminPassword is required"}), 400

    admin_id = get_jwt_identity()
    admin = User.query.get(admin_id)
    if not admin or not check_password_hash(admin.password, admin_password):
        log_action(
            'admin.2fa_reset',
            user_id=admin_id,
            user_email=admin.email if admin else None,
            resource_type='user',
            resource_id=user_id,
            status='failure',
            extra={'reason': 'invalid_admin_password'},
        )
        db.session.commit()
        return jsonify({"error": "Admin password is incorrect"}), 401

    target = User.query.get(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    if not two_factor.is_enrolled(target) and not target.totp_secret:
        return jsonify({"error": "User is not enrolled in 2FA"}), 400

    two_factor.disable(target)
    log_action(
        'admin.2fa_reset',
        user_id=admin.id,
        user_email=admin.email,
        resource_type='user',
        resource_id=target.id,
        extra={'target_email': target.email},
    )
    db.session.commit()
    return jsonify({
        "message": "2FA reset. User will be prompted to re-enroll if 2FA is required.",
        "userId": target.id,
        "twoFactorEnrolled": False,
    }), 200


@bp.route('/api/admin/users/<string:user_id>/deactivate', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
@limiter.limit("10 per minute")
def admin_deactivate_user(user_id):
    """Off-board a user: block future logins and revoke every live session so
    access is cut immediately. Their notes/templates/participants are kept.
    Requires the admin's own password as re-auth, like the other admin account
    actions. Reversible via /activate."""
    data = request.get_json(silent=True) or {}
    admin_password = data.get('adminPassword')
    if not isinstance(admin_password, str) or not admin_password:
        return jsonify({"error": "adminPassword is required"}), 400

    admin_id = get_jwt_identity()
    if admin_id == user_id:
        return jsonify({"error": "You can't deactivate your own account"}), 400

    admin = User.query.get(admin_id)
    if not admin or not check_password_hash(admin.password, admin_password):
        log_action(
            'admin.user_deactivate',
            user_id=admin_id,
            user_email=admin.email if admin else None,
            resource_type='user',
            resource_id=user_id,
            status='failure',
            extra={'reason': 'invalid_admin_password'},
        )
        db.session.commit()
        return jsonify({"error": "Admin password is incorrect"}), 401

    target = User.query.get(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    if not target.is_active:
        return jsonify({"error": "User is already deactivated"}), 400
    # Don't strand the install with no way back in.
    if target.role == 'admin':
        other_admins = User.query.filter(
            User.role == 'admin', User.is_active.is_(True), User.id != target.id
        ).count()
        if other_admins == 0:
            return jsonify({"error": "Can't deactivate the last active admin"}), 409

    target.is_active = False
    revoked = sessions.revoke_user_sessions(target.id, 'user_deactivated')
    log_action(
        'admin.user_deactivate',
        user_id=admin.id,
        user_email=admin.email,
        resource_type='user',
        resource_id=target.id,
        extra={'target_email': target.email, 'sessions_revoked': revoked},
    )
    db.session.commit()
    return jsonify({
        "userId": target.id,
        "isActive": False,
        "sessionsRevoked": revoked,
    }), 200


@bp.route('/api/admin/users/<string:user_id>/activate', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
@limiter.limit("10 per minute")
def admin_activate_user(user_id):
    """Re-enable a previously deactivated user so they can sign in again.
    Requires the admin's own password as re-auth."""
    data = request.get_json(silent=True) or {}
    admin_password = data.get('adminPassword')
    if not isinstance(admin_password, str) or not admin_password:
        return jsonify({"error": "adminPassword is required"}), 400

    admin = User.query.get(get_jwt_identity())
    if not admin or not check_password_hash(admin.password, admin_password):
        log_action(
            'admin.user_activate',
            user_id=admin.id if admin else None,
            user_email=admin.email if admin else None,
            resource_type='user',
            resource_id=user_id,
            status='failure',
            extra={'reason': 'invalid_admin_password'},
        )
        db.session.commit()
        return jsonify({"error": "Admin password is incorrect"}), 401

    target = User.query.get(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    if target.is_active:
        return jsonify({"error": "User is already active"}), 400

    target.is_active = True
    log_action(
        'admin.user_activate',
        user_id=admin.id,
        user_email=admin.email,
        resource_type='user',
        resource_id=target.id,
        extra={'target_email': target.email},
    )
    db.session.commit()
    return jsonify({"userId": target.id, "isActive": True}), 200


@bp.route('/api/admin/users/<string:user_id>/roles', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def admin_set_user_roles(user_id):
    """Replace a user's role assignments with the given set of role ids.
    Unknown ids are ignored. Roles scope which shared templates the user
    sees — no password re-auth, unlike the credential-level admin actions."""
    data = request.get_json(silent=True) or {}
    role_ids = data.get('roleIds')
    if not isinstance(role_ids, list):
        return jsonify({"error": "roleIds must be a list"}), 400

    target = User.query.get(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404

    roles = Role.query.filter(Role.id.in_(role_ids)).all()
    target.roles = roles
    log_action(
        'admin.user_roles_set',
        user_id=get_jwt_identity(),
        resource_type='user',
        resource_id=target.id,
        extra={'role_ids': [r.id for r in roles], 'role_names': [r.name for r in roles]},
    )
    db.session.commit()
    return jsonify({
        "userId": target.id,
        "roles": [{"id": r.id, "name": r.name} for r in target.roles],
    }), 200
