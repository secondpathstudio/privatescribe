"""add user_session table and user.is_active

Revision ID: d7e8f9a0b1c2
Revises: f1a2b3c4d5e6
Create Date: 2026-05-16 09:00:00.000000

Server-side sessions (for logout, idle timeout, and forced sign-out) plus
an is_active flag for account deactivation / off-boarding. Existing users
default to active so nobody is locked out by the upgrade.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd7e8f9a0b1c2'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'is_active',
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )

    # Hand-written with IF NOT EXISTS: db.create_all() will already have added
    # this table on any boot since the Session model was registered, so the
    # migration must be idempotent on existing dev databases.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_session (
            id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            created_at DATETIME NOT NULL,
            last_active_at DATETIME NOT NULL,
            revoked BOOLEAN NOT NULL,
            revoked_at DATETIME,
            revoked_reason VARCHAR(32),
            ip_address VARCHAR(64),
            user_agent VARCHAR(256),
            PRIMARY KEY (id),
            FOREIGN KEY(user_id) REFERENCES user (id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_session_user_id ON user_session (user_id)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_user_session_user_id")
    op.drop_table('user_session')
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('is_active')
