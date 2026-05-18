"""add account lockout fields to user

Revision ID: a3c5e7b9d1f4
Revises: e1a2b3c4d5f6
Create Date: 2026-05-17 12:00:00.000000

Per-account brute-force backstop (GAP-03). `failed_login_count` tracks
consecutive failed password attempts; `locked_until` is the UTC time a
threshold-crossed account stays locked until. Existing rows default to an
unlocked state (count 0, locked_until NULL) so no one is suddenly locked out.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3c5e7b9d1f4'
down_revision = 'e1a2b3c4d5f6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'failed_login_count',
                sa.Integer(),
                nullable=False,
                server_default='0',
            )
        )
        batch_op.add_column(
            sa.Column('locked_until', sa.DateTime(), nullable=True)
        )


def downgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('locked_until')
        batch_op.drop_column('failed_login_count')
