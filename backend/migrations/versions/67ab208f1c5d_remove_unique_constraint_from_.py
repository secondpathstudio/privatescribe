"""remove unique constraint from participant email

Revision ID: 67ab208f1c5d
Revises: 
Create Date: 2025-05-24 11:00:14.045918

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '67ab208f1c5d'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # For SQLite, you need to recreate the table
    with op.batch_alter_table('participant', schema=None) as batch_op:
        batch_op.alter_column('email', existing_type=sa.String(120), unique=False)

def downgrade():
    with op.batch_alter_table('participant', schema=None) as batch_op:
        batch_op.create_unique_constraint('email', ['email'])
