"""Template visibility helpers.

A user always sees their own templates. They also see a template they don't
own when it's shared (template_roles) with a role they hold (user_roles).
Shared-in templates are read-only — the write routes stay author-scoped, so
this module only governs *read* access. See models/role.py.
"""
from app.extensions import db
from app.models import template_roles, user_roles


def shared_template_ids_for_user(user_id):
    """A query of template ids shared with any role `user_id` holds.

    Returned as a Query so callers can drop it straight into
    Template.id.in_(...) as a subquery.
    """
    return (
        db.session.query(template_roles.c.template_id)
        .join(user_roles, user_roles.c.role_id == template_roles.c.role_id)
        .filter(user_roles.c.user_id == user_id)
    )


def template_shared_with_user(template_id, user_id) -> bool:
    """True when `template_id` is shared with at least one role `user_id` holds."""
    row = (
        db.session.query(template_roles.c.template_id)
        .join(user_roles, user_roles.c.role_id == template_roles.c.role_id)
        .filter(
            template_roles.c.template_id == template_id,
            user_roles.c.user_id == user_id,
        )
        .first()
    )
    return row is not None
