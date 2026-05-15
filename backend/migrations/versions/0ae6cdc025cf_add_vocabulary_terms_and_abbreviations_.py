"""add vocabulary_terms and abbreviations to user

Revision ID: 0ae6cdc025cf
Revises: a09f8b7c6d5e
Create Date: 2026-05-15 10:03:05.860778

Autogenerate also wanted to drop and re-create the SQLite FTS5 virtual
tables (notes_fts and its shadow tables) because Alembic can't introspect
them. Those statements were removed manually — they aren't part of this
migration's actual intent and would break full-text search.
"""
from alembic import op
import sqlalchemy as sa


revision = '0ae6cdc025cf'
down_revision = 'a09f8b7c6d5e'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        # SQLite can't add a NOT NULL column without a default, so we seed
        # existing rows with the JSON empty container that matches the
        # SQLAlchemy model default.
        batch_op.add_column(
            sa.Column('vocabulary_terms', sa.Text(), nullable=False, server_default='[]')
        )
        batch_op.add_column(
            sa.Column('abbreviations', sa.Text(), nullable=False, server_default='{}')
        )


def downgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('abbreviations')
        batch_op.drop_column('vocabulary_terms')
