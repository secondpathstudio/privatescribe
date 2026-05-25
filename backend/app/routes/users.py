from flask import Blueprint, jsonify, request
from flask_cors import cross_origin
from flask_jwt_extended import get_jwt_identity, jwt_required
from werkzeug.security import check_password_hash, generate_password_hash

from app.extensions import db, limiter
from app.models import (AudioFile, Note, NoteAddendum, Organization,
                        Participant, Role, Template, User)
from app.security import account_lockout, password_policy, sessions
from app.security.auth import (ROLE_ADMIN, ROLE_SUPER_ADMIN, is_super_admin,
                               require_admin, require_super_admin)
from app.services import two_factor
from app.services.audit import log_action

bp = Blueprint("users", __name__)


def _users_in_scope(actor):
    """Base User query limited to what `actor` may manage: every user for a
    super-admin, else only the actor's own organization."""
    if is_super_admin(actor):
        return User.query
    return User.query.filter(User.organization_id == actor.organization_id)


def _can_manage_target(actor, target) -> bool:
    """Whether `actor` may act on `target`. Super-admins manage anyone; an
    org-admin manages only non-super-admin users in their own organization."""
    if is_super_admin(actor):
        return True
    if is_super_admin(target):
        return False  # an org-admin must never act on a super-admin
    return actor.organization_id == target.organization_id


def _validate_new_password(value) -> str | None:
    """Returns an error message if invalid, else None. Strength rules are
    delegated to the shared policy validator (app/security/password_policy.py)
    so every credential path enforces the same admin-configured policy."""
    if not isinstance(value, str) or not value:
        return "newPassword is required"
    return password_policy.validate(value)


@bp.route('/api/getAllUsers', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
def get_all_users():
    # Org-admins see only their own organization's users; super-admins see all.
    actor = User.query.get(get_jwt_identity())
    users = _users_in_scope(actor).all()
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
        # Brute-force lockout state. accountLocked reflects an *unexpired* lock;
        # lockedUntil is the raw timestamp (may be in the past once the lock has
        # lapsed). failedLoginCount lets admins spot an account under attack
        # before it actually locks.
        "accountLocked": account_lockout.is_locked(user),
        "lockedUntil": user.locked_until,
        "failedLoginCount": user.failed_login_count,
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

    pw_err = password_policy.validate(data.get('password'))
    if pw_err:
        return jsonify({"error": pw_err}), 400

    actor = User.query.get(get_jwt_identity())

    # Role escalation guard: an org-admin may create users and org-admins;
    # only a super-admin may mint another super-admin.
    role = data.get('role', 'user')
    allowed_roles = {'user', ROLE_ADMIN}
    if is_super_admin(actor):
        allowed_roles.add(ROLE_SUPER_ADMIN)
    if role not in allowed_roles:
        return jsonify({"error": "Invalid role"}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({"error": "User email already exists"}), 400

    # Org assignment: org-admins create within their own organization; a
    # super-admin may place the user in any org via organizationId (else their
    # own, which may be none for central IT).
    if is_super_admin(actor) and data.get('organizationId'):
        org = Organization.query.get(data['organizationId'])
        if not org:
            return jsonify({"error": "organizationId does not exist"}), 400
    else:
        org = actor.organization

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
    if not target or not _can_manage_target(admin, target):
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
    if not target or not _can_manage_target(admin, target):
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


@bp.route('/api/admin/users/<string:user_id>/unlock', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_admin
@limiter.limit("10 per minute")
def admin_unlock_account(user_id):
    """Clear a user's brute-force lockout and failed-attempt counter so they
    can sign in again immediately, rather than waiting out the lock window.
    Requires the admin's own password as re-auth, like the other admin account
    actions. A locked account also unlocks itself once the window passes — this
    is the manual override."""
    data = request.get_json(silent=True) or {}
    admin_password = data.get('adminPassword')
    if not isinstance(admin_password, str) or not admin_password:
        return jsonify({"error": "adminPassword is required"}), 400

    admin_id = get_jwt_identity()
    admin = User.query.get(admin_id)
    if not admin or not check_password_hash(admin.password, admin_password):
        log_action(
            'admin.account_unlock',
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
    if not target or not _can_manage_target(admin, target):
        return jsonify({"error": "User not found"}), 404

    account_lockout.unlock(target)
    log_action(
        'admin.account_unlock',
        user_id=admin.id,
        user_email=admin.email,
        resource_type='user',
        resource_id=target.id,
        extra={'target_email': target.email},
    )
    db.session.commit()
    return jsonify({
        "userId": target.id,
        "accountLocked": False,
        "failedLoginCount": 0,
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
    if not target or not _can_manage_target(admin, target):
        return jsonify({"error": "User not found"}), 404
    if not target.is_active:
        return jsonify({"error": "User is already deactivated"}), 400
    # Don't strand an administrative scope with no way back in.
    if target.role == ROLE_SUPER_ADMIN:
        # Server-wide scope: protected unless another active super-admin remains.
        others = User.query.filter(
            User.role == ROLE_SUPER_ADMIN, User.is_active.is_(True), User.id != target.id
        ).count()
        if others == 0:
            return jsonify({"error": "Can't deactivate the last active super-admin"}), 409
    elif target.role == ROLE_ADMIN:
        # Org scope: covered by another active org-admin of the same org, or by
        # any active super-admin (who can administer every org).
        others = User.query.filter(
            User.is_active.is_(True),
            User.id != target.id,
            db.or_(
                User.role == ROLE_SUPER_ADMIN,
                db.and_(User.role == ROLE_ADMIN,
                        User.organization_id == target.organization_id),
            ),
        ).count()
        if others == 0:
            return jsonify({"error": "Can't deactivate the last active admin for this organization"}), 409

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
    if not target or not _can_manage_target(admin, target):
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

    actor = User.query.get(get_jwt_identity())
    target = User.query.get(user_id)
    if not target or not _can_manage_target(actor, target):
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


# PHI models owned by a user (via author_id) whose organization_id must move
# with the user on reassignment, or the org-guard would hide the user's own
# history (it filters reads by the user's *current* org). Mirrors the
# author-owned set in services/org_stamp.py (AuditLog is intentionally excluded
# — audit rows record the org an action happened in and must not be rewritten).
_USER_PHI_MODELS = (Note, Template, Participant, AudioFile, NoteAddendum)


@bp.route('/api/admin/users/<string:user_id>/organization', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@require_super_admin
def admin_set_user_organization(user_id):
    """Move a user to a different organization (department). Super-admin only —
    this is a cross-org action. Re-stamps the user's owned PHI (notes,
    templates, participants, audio, addenda) to the new org so their history
    follows them and stays visible under the org-guard. Audit rows are left as
    they were (they record where each action originally happened)."""
    data = request.get_json(silent=True) or {}
    org_id = data.get('organizationId')
    if not org_id:
        return jsonify({"error": "organizationId is required"}), 400

    target = User.query.get(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    # A super-admin is org-less central IT by design; don't pin them to an org.
    if is_super_admin(target):
        return jsonify({"error": "Super-admin accounts are not part of an organization"}), 400

    new_org = Organization.query.get(org_id)
    if not new_org:
        return jsonify({"error": "organizationId does not exist"}), 400

    if target.organization_id == new_org.id:
        return jsonify({"error": "User is already in that organization"}), 400

    target.organization_id = new_org.id
    # Move the user's owned PHI to the new org in the same transaction.
    restamped = 0
    for model in _USER_PHI_MODELS:
        restamped += model.query.filter(model.author_id == user_id).update(
            {model.organization_id: new_org.id}, synchronize_session=False
        )

    log_action(
        'admin.user_org_set',
        user_id=get_jwt_identity(),
        resource_type='user',
        resource_id=target.id,
        extra={'target_email': target.email, 'organization_id': new_org.id,
               'organization_name': new_org.name, 'phi_rows_restamped': restamped},
    )
    db.session.commit()
    return jsonify({
        "userId": target.id,
        "organization": {"id": new_org.id, "name": new_org.name},
        "phiRowsRestamped": restamped,
    }), 200
