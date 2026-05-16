"""add role, user_roles, and template_roles tables

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-05-16 13:00:00.000000

Adds the role system for template sharing: a role table plus the user<->role
and template<->role join tables. Hand-written with IF NOT EXISTS — db.create_all()
will already have added these on any boot since the models were registered,
so this stays idempotent on existing dev databases (it just advances the
Alembic version pointer).
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b9c0d1e2f3a4'
down_revision = 'a8b9c0d1e2f3'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS role (
            id VARCHAR(36) NOT NULL,
            name VARCHAR(50) NOT NULL,
            created_at DATETIME,
            PRIMARY KEY (id),
            UNIQUE (name)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_roles (
            user_id VARCHAR(36) NOT NULL,
            role_id VARCHAR(36) NOT NULL,
            PRIMARY KEY (user_id, role_id),
            FOREIGN KEY(user_id) REFERENCES user (id) ON DELETE CASCADE,
            FOREIGN KEY(role_id) REFERENCES role (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS template_roles (
            template_id VARCHAR(36) NOT NULL,
            role_id VARCHAR(36) NOT NULL,
            PRIMARY KEY (template_id, role_id),
            FOREIGN KEY(template_id) REFERENCES template (id) ON DELETE CASCADE,
            FOREIGN KEY(role_id) REFERENCES role (id) ON DELETE CASCADE
        )
        """
    )


def downgrade():
    op.drop_table('template_roles')
    op.drop_table('user_roles')
    op.drop_table('role')
