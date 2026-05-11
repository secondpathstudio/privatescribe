"""add template_type + structured columns to template

Revision ID: e6b2c3d4f8a9
Revises: d5a1b2c3e6f7
Create Date: 2026-05-11 01:00:00.000000

Templates gain a discriminator so a single table can hold both:
  - 'simple' templates: Markdown skeleton in `content`, filled in a single
    Ollama pass by /api/getMarkdown (existing behavior).
  - 'structured' templates: typed tree in `structured` (Section -> Field tree
    with per-field strictness/prompts). Built externally; runtime support
    for executing them lands in a later phase.

Existing rows default to template_type='simple', structured=NULL — no
behavior change for anything that was already in the DB.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e6b2c3d4f8a9'
down_revision = 'd5a1b2c3e6f7'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('template', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'template_type',
                sa.String(length=16),
                nullable=False,
                server_default='simple',
            )
        )
        batch_op.add_column(sa.Column('structured', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('template', schema=None) as batch_op:
        batch_op.drop_column('structured')
        batch_op.drop_column('template_type')
