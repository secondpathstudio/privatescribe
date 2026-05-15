"""Full-text note search backed by SQLite FTS5.

The virtual table `notes_fts` mirrors `note.note_content_raw` and
`note.note_content_markdown`. It's kept in sync via mapper-level SQLAlchemy
event listeners registered on import — `create_app()` imports this module
once so the listeners are wired before any session activity.

Soft-deleted notes remain indexed; the `is_deleted` filter is applied at
query time so restore is free.
"""
from __future__ import annotations

import re
from typing import Iterable

from sqlalchemy import event, inspect, text

from app.extensions import db
from app.models import Note


# Match-highlight markers. ASCII control chars (STX / ETX) — never appear in
# legitimate text content, so the frontend can split on them safely without
# risk of collision with user input. Using raw HTML tags here would force the
# frontend to either HTML-escape the surrounding text (which FTS5's snippet()
# does NOT do) or use dangerouslySetInnerHTML.
HIGHLIGHT_OPEN = "\x02"
HIGHLIGHT_CLOSE = "\x03"


FTS_TABLE_DDL = """
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    note_id UNINDEXED,
    author_id UNINDEXED,
    note_content_raw,
    note_content_markdown,
    tokenize = 'unicode61 remove_diacritics 2'
)
"""


def ensure_fts_table() -> None:
    """Create the FTS table if it doesn't exist and backfill any missing rows.

    Called from create_app() so fresh databases (which come up via
    db.create_all() without running Alembic) still get the index. The
    migration creates the same table — both paths are idempotent.

    The backfill is also self-healing: if a Note was somehow inserted
    without going through the ORM event listeners (raw SQL, restored from
    backup, etc.), it gets indexed on the next boot.
    """
    db.session.execute(text(FTS_TABLE_DDL))
    db.session.execute(
        text(
            """
            INSERT INTO notes_fts(note_id, author_id, note_content_raw, note_content_markdown)
            SELECT n.id, n.author_id,
                   COALESCE(n.note_content_raw, ''),
                   COALESCE(n.note_content_markdown, '')
            FROM note n
            WHERE n.id NOT IN (SELECT note_id FROM notes_fts)
            """
        )
    )
    db.session.commit()


def index_note(connection, note: Note) -> None:
    """Replace the FTS row for `note` (delete + insert)."""
    connection.execute(
        text("DELETE FROM notes_fts WHERE note_id = :nid"),
        {"nid": note.id},
    )
    connection.execute(
        text(
            "INSERT INTO notes_fts(note_id, author_id, note_content_raw, note_content_markdown) "
            "VALUES (:nid, :aid, :raw, :md)"
        ),
        {
            "nid": note.id,
            "aid": note.author_id,
            "raw": note.note_content_raw or "",
            "md": note.note_content_markdown or "",
        },
    )


def unindex_note(connection, note_id: str) -> None:
    connection.execute(
        text("DELETE FROM notes_fts WHERE note_id = :nid"),
        {"nid": note_id},
    )


# FTS5 special characters that would otherwise be interpreted as query
# operators (AND/OR/NOT/NEAR/parens/quotes/colons/asterisks/hyphens).
# We tokenize on whitespace, strip operator-like punctuation from each
# token, quote it as a phrase, and append `*` for prefix matching. Result:
# multi-word queries become AND-of-prefix-matches, which is what users
# usually want from a search box.
_TOKEN_STRIP = re.compile(r"[\"\*\(\)\:\-]")


def _build_fts_query(user_query: str) -> str | None:
    tokens: list[str] = []
    for raw_tok in user_query.split():
        cleaned = _TOKEN_STRIP.sub(" ", raw_tok).strip()
        if not cleaned:
            continue
        # Embedded whitespace after stripping → treat each piece as its own token.
        for piece in cleaned.split():
            tokens.append(f'"{piece}"*')
    if not tokens:
        return None
    return " ".join(tokens)


def search_notes(
    user_id: str,
    query: str,
    *,
    include_deleted: bool = False,
    limit: int = 50,
) -> list[dict]:
    """Return up to `limit` FTS hits for `user_id`, BM25-ranked.

    Each hit is `{note_id, raw_snippet, markdown_snippet}`. The caller is
    responsible for hydrating note metadata from the ORM.
    """
    fts_q = _build_fts_query(query)
    if fts_q is None:
        return []

    rows = db.session.execute(
        text(
            """
            SELECT
                note_id,
                snippet(notes_fts, 2, :hl_open, :hl_close, '…', 12) AS raw_snippet,
                snippet(notes_fts, 3, :hl_open, :hl_close, '…', 12) AS markdown_snippet,
                bm25(notes_fts) AS rank
            FROM notes_fts
            WHERE notes_fts MATCH :q AND author_id = :uid
            ORDER BY rank
            LIMIT :lim
            """
        ),
        {
            "q": fts_q,
            "uid": user_id,
            "lim": limit,
            "hl_open": HIGHLIGHT_OPEN,
            "hl_close": HIGHLIGHT_CLOSE,
        },
    ).fetchall()

    return [
        {
            "note_id": r.note_id,
            "raw_snippet": r.raw_snippet,
            "markdown_snippet": r.markdown_snippet,
        }
        for r in rows
    ]


# --- Sync listeners ---------------------------------------------------------
# Mapper-level events fire during flush, inside the same transaction as the
# Note write, so the FTS index is committed atomically with the ORM change.

@event.listens_for(Note, "after_insert")
def _note_after_insert(mapper, connection, target):
    index_note(connection, target)


@event.listens_for(Note, "after_update")
def _note_after_update(mapper, connection, target):
    # Only re-index when indexed text actually changed. Skipping no-op
    # updates (touching only updated_at, version, is_deleted, etc.) keeps
    # the FTS index from churning unnecessarily.
    state = inspect(target)
    raw_hist = state.attrs.note_content_raw.history
    md_hist = state.attrs.note_content_markdown.history
    if not (raw_hist.has_changes() or md_hist.has_changes()):
        return
    index_note(connection, target)


@event.listens_for(Note, "after_delete")
def _note_after_delete(mapper, connection, target):
    unindex_note(connection, target.id)
