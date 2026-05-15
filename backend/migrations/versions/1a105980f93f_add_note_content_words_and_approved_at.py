"""add note_content_words and approved_at

Revision ID: 1a105980f93f
Revises: 0ae6cdc025cf
Create Date: 2026-05-15 10:35:15.623905

Autogenerate also wanted to drop the FTS5 virtual tables (notes_fts and
its shadow tables). Those drops were removed manually — Alembic can't
introspect SQLite virtual tables but they're real and load-bearing.
"""
from alembic import op
import sqlalchemy as sa


revision = '1a105980f93f'
down_revision = '0ae6cdc025cf'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('note', schema=None) as batch_op:
        batch_op.add_column(sa.Column('note_content_words', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('approved_at', sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table('note', schema=None) as batch_op:
        batch_op.drop_column('approved_at')
        batch_op.drop_column('note_content_words')
