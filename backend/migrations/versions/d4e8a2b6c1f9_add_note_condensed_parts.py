"""add note.condensed_parts

Revision ID: d4e8a2b6c1f9
Revises: c7d9e1f3a5b8
Create Date: 2026-11-09

How many parts the AI read a too-long transcript in when it formatted the
note (services/llm_batching.py). Null for the usual single-pass note. The
note page uses it to tell the reader to check the note against the
transcript.

Idempotent on purpose: create_app() runs schema_reconcile on boot, which adds
missing columns before `flask db upgrade` ever runs, so upgrade() only adds
the column when it's actually missing.
"""
from alembic import op
import sqlalchemy as sa


revision = 'd4e8a2b6c1f9'
down_revision = 'c7d9e1f3a5b8'
branch_labels = None
depends_on = None


def _note_columns():
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns('note')}


def upgrade():
    if 'condensed_parts' not in _note_columns():
        with op.batch_alter_table('note', schema=None) as batch_op:
            batch_op.add_column(sa.Column('condensed_parts', sa.Integer(), nullable=True))


def downgrade():
    if 'condensed_parts' in _note_columns():
        with op.batch_alter_table('note', schema=None) as batch_op:
            batch_op.drop_column('condensed_parts')
