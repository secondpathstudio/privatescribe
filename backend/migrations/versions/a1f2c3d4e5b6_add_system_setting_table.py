"""add system_setting table

Revision ID: a1f2c3d4e5b6
Revises: e3ba93127219
Create Date: 2026-05-09 22:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1f2c3d4e5b6'
down_revision = 'e3ba93127219'
branch_labels = None
depends_on = None


def upgrade():
    # Hand-written: db.create_all() will have already added this table on any
    # boot since the SystemSetting model was registered, so use IF NOT EXISTS
    # to make the migration idempotent on existing dev databases.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS system_setting (
            key VARCHAR(64) NOT NULL,
            value TEXT NOT NULL,
            updated_at DATETIME,
            updated_by VARCHAR(36),
            PRIMARY KEY (key),
            FOREIGN KEY(updated_by) REFERENCES user (id)
        )
        """
    )


def downgrade():
    with op.batch_alter_table('system_setting', schema=None) as batch_op:
        pass
    op.drop_table('system_setting')
