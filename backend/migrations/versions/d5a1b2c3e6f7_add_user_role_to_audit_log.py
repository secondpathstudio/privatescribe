"""add user_role snapshot to audit_log

Revision ID: d5a1b2c3e6f7
Revises: c4f0d1a2b3e5
Create Date: 2026-05-11 00:30:00.000000

Audit log records the user's role at the time of the action, not their
current role. Snapshot lives next to the existing denormalized user_email
column for the same reason: the log should answer "what privilege did the
actor have when they did this," even if the user is later promoted/demoted
or deleted.

Pre-existing rows are left with user_role = NULL; backfilling them with
the user's *current* role would be misleading (it would imply the role
was a snapshot when it isn't).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd5a1b2c3e6f7'
down_revision = 'c4f0d1a2b3e5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.add_column(sa.Column('user_role', sa.String(length=32), nullable=True))


def downgrade():
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.drop_column('user_role')
