"""Template visibility helpers.

A user always sees their own templates. They also see a template they don't
own when it's shared (template_roles) with a role they hold (user_roles).
Shared-in templates are read-only — the write routes stay author-scoped, so
this module only governs *read* access. See models/role.py.

Tenant boundary (Phase 8 item 6): sharing is confined to the user's own
organization. Even if a role spans orgs, a template is only visible to
role-holders **in its own org** — so a department's templates never leak to
a same-named role in another department.
"""
from app.extensions import db
from app.models import Template, template_roles, user_roles
from app.security.org_context import org_id_for_user


def _org_confined(query, user_org_id):
    """Restrict a template_roles query to templates in the user's organization.

    NULL-safe: an org-less user (standalone) sees only org-less templates; an
    org user sees only same-org templates. Avoids a ``= NULL`` subquery, which
    would never match and would silently break standalone sharing.
    """
    query = query.join(Template, Template.id == template_roles.c.template_id)
    if user_org_id is None:
        return query.filter(Template.organization_id.is_(None))
    return query.filter(Template.organization_id == user_org_id)


def shared_template_ids_for_user(user_id):
    """A query of template ids shared with any role `user_id` holds, confined
    to the user's organization.

    Returned as a Query so callers can drop it straight into
    Template.id.in_(...) as a subquery.
    """
    q = (
        db.session.query(template_roles.c.template_id)
        .join(user_roles, user_roles.c.role_id == template_roles.c.role_id)
        .filter(user_roles.c.user_id == user_id)
    )
    return _org_confined(q, org_id_for_user(user_id))


def template_shared_with_user(template_id, user_id) -> bool:
    """True when `template_id` is shared with a role `user_id` holds **and**
    the template is in the user's organization."""
    q = (
        db.session.query(template_roles.c.template_id)
        .join(user_roles, user_roles.c.role_id == template_roles.c.role_id)
        .filter(
            template_roles.c.template_id == template_id,
            user_roles.c.user_id == user_id,
        )
    )
    return _org_confined(q, org_id_for_user(user_id)).first() is not None
