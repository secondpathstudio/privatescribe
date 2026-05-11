"""add force_password_change to user

Revision ID: f7c3d4e5b6a8
Revises: e6b2c3d4f8a9
Create Date: 2026-05-11 01:30:00.000000

Lets admin password resets demand a follow-up change from the target user.
Existing rows default to False so currently-logged-in users aren't suddenly
forced to rotate.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f7c3d4e5b6a8'
down_revision = 'e6b2c3d4f8a9'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'force_password_change',
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('force_password_change')
