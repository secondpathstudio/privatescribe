"""add name column to note

Revision ID: 21f60e821083
Revises: 1a105980f93f
Create Date: 2026-05-15 13:09:50.421740

Adds an optional user-supplied title for the note. Nullable so existing
rows remain valid; the UI falls back to "<template> – <datetime>" when
the column is null.

Autogenerate also flagged the notes_fts5 virtual tables for drop because
they're created via raw SQL in a prior migration and aren't visible to
SQLAlchemy's metadata. Those drops are intentionally stripped — this
migration only touches the `note.name` column.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '21f60e821083'
down_revision = '1a105980f93f'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('note', schema=None) as batch_op:
        batch_op.add_column(sa.Column('name', sa.String(length=120), nullable=True))


def downgrade():
    with op.batch_alter_table('note', schema=None) as batch_op:
        batch_op.drop_column('name')
