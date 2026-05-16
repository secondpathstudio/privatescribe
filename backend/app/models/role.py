import uuid
from datetime import datetime

from app.extensions import db


# Many-to-many: users <-> roles. A user can hold several roles.
user_roles = db.Table(
    'user_roles',
    db.Column('user_id', db.String(36), db.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
    db.Column('role_id', db.String(36), db.ForeignKey('role.id', ondelete='CASCADE'), primary_key=True),
)

# Many-to-many: templates <-> roles. A template is shared with a set of roles;
# a user sees a shared template if they hold one of those roles.
template_roles = db.Table(
    'template_roles',
    db.Column('template_id', db.String(36), db.ForeignKey('template.id', ondelete='CASCADE'), primary_key=True),
    db.Column('role_id', db.String(36), db.ForeignKey('role.id', ondelete='CASCADE'), primary_key=True),
)


class Role(db.Model):
    """An app-wide, admin-managed role.

    Orthogonal to User.role (the admin/user privilege flag) — these roles
    exist purely to scope template sharing: an admin shares a template with
    one or more roles, and a user sees it if they hold a matching role.
    """
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(50), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<Role {self.name}>"
