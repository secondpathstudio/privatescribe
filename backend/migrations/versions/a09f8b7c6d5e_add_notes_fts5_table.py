"""add notes_fts5 virtual table for full-text note search

Revision ID: a09f8b7c6d5e
Revises: 6ef69797154f
Create Date: 2026-05-14 21:00:00.000000

FTS5 virtual table that mirrors note.note_content_raw and
note.note_content_markdown. The table is kept in sync at write time via
SQLAlchemy event listeners in app/services/note_search.py — this migration
only creates the table and backfills existing rows.

The same CREATE is also run on app startup (ensure_fts_table) so fresh
databases that come up via db.create_all() without going through Alembic
still get the index.
"""
from alembic import op


revision = 'a09f8b7c6d5e'
down_revision = '6ef69797154f'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            note_id UNINDEXED,
            author_id UNINDEXED,
            note_content_raw,
            note_content_markdown,
            tokenize = 'unicode61 remove_diacritics 2'
        )
        """
    )
    op.execute(
        """
        INSERT INTO notes_fts(note_id, author_id, note_content_raw, note_content_markdown)
        SELECT id, author_id,
               COALESCE(note_content_raw, ''),
               COALESCE(note_content_markdown, '')
        FROM note
        WHERE id NOT IN (SELECT note_id FROM notes_fts)
        """
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS notes_fts")
