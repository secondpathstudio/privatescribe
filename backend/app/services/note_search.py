"""Full-text note search behind a backend-agnostic interface.

This is seam #2 of the Postgres-ready work (roadmap Phase 7). The engine-
specific search logic lives inside a ``SearchBackend``; the module's public
surface — ``ensure_fts_table()``, ``index_note()``, ``unindex_note()``,
``search_notes()`` — and the mapper-event listeners only ever call that
interface. Today the one backend is SQLite FTS5; a Postgres ``tsvector`` + GIN
backend slots in here later without touching routes, models, or the event
wiring.

The mirror covers ``note.note_content_raw`` and ``note.note_content_markdown``
and is kept in sync via mapper-level SQLAlchemy event listeners registered on
import — ``create_app()`` imports this module once so the listeners are wired
before any session activity. Soft-deleted notes remain indexed; the
``is_deleted`` filter is applied by the caller after hydration, so restore is
free.
"""
from __future__ import annotations

import re
from abc import ABC, abstractmethod

from sqlalchemy import event, inspect, text

from app.extensions import db
from app.models import Note


# Match-highlight markers, part of the cross-backend contract: every backend
# wraps hits in these and the frontend splits on them. ASCII control chars
# (STX / ETX) never appear in legitimate text, so splitting can't collide with
# user input. Raw HTML tags would instead force the frontend to either escape
# the surrounding text (FTS5's snippet() does NOT) or use dangerouslySetInnerHTML.
HIGHLIGHT_OPEN = "\x02"
HIGHLIGHT_CLOSE = "\x03"


class SearchBackend(ABC):
    """Engine-specific full-text search over notes.

    Implementations own their schema (FTS5 virtual table, Postgres tsvector
    column + GIN index, …) but expose the same operations so the rest of the
    app never branches on the engine. ``index``/``unindex`` run on the flush
    ``connection`` so they commit atomically with the Note write; ``search``
    uses the request-scoped ``db.session``.
    """

    @abstractmethod
    def ensure_schema(self) -> None:
        """Create the index structure if absent and backfill missing rows."""

    @abstractmethod
    def index(self, connection, note: Note) -> None:
        """Upsert the index entry for ``note``."""

    @abstractmethod
    def unindex(self, connection, note_id: str) -> None:
        """Remove the index entry for ``note_id``."""

    @abstractmethod
    def search(
        self,
        user_id: str,
        query: str,
        *,
        include_deleted: bool = False,
        limit: int = 50,
    ) -> list[dict]:
        """Return up to ``limit`` hits ``{note_id, raw_snippet, markdown_snippet}``."""


class Fts5Backend(SearchBackend):
    """SQLite FTS5 backend — the live path for standalone and the SQLite server."""

    FTS_TABLE_DDL = """
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        note_id UNINDEXED,
        author_id UNINDEXED,
        note_content_raw,
        note_content_markdown,
        tokenize = 'unicode61 remove_diacritics 2'
    )
    """

    # FTS5 special characters that would otherwise be interpreted as query
    # operators (AND/OR/NOT/NEAR/parens/quotes/colons/asterisks/hyphens). We
    # tokenize on whitespace, strip operator-like punctuation from each token,
    # quote it as a phrase, and append `*` for prefix matching. Result:
    # multi-word queries become AND-of-prefix-matches, what a search box wants.
    _TOKEN_STRIP = re.compile(r"[\"\*\(\)\:\-]")

    def ensure_schema(self) -> None:
        """Create the FTS table if it doesn't exist and backfill missing rows.

        Called from create_app() so fresh databases (which come up via
        db.create_all() without running Alembic) still get the index. The
        migration creates the same table — both paths are idempotent.

        The backfill is self-healing: a Note inserted outside the ORM event
        listeners (raw SQL, restored from backup, etc.) gets indexed on the
        next boot.
        """
        db.session.execute(text(self.FTS_TABLE_DDL))
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

    def index(self, connection, note: Note) -> None:
        """Replace the FTS row for ``note`` (delete + insert)."""
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

    def unindex(self, connection, note_id: str) -> None:
        connection.execute(
            text("DELETE FROM notes_fts WHERE note_id = :nid"),
            {"nid": note_id},
        )

    def _build_query(self, user_query: str) -> str | None:
        tokens: list[str] = []
        for raw_tok in user_query.split():
            cleaned = self._TOKEN_STRIP.sub(" ", raw_tok).strip()
            if not cleaned:
                continue
            # Embedded whitespace after stripping → each piece is its own token.
            for piece in cleaned.split():
                tokens.append(f'"{piece}"*')
        if not tokens:
            return None
        return " ".join(tokens)

    def search(
        self,
        user_id: str,
        query: str,
        *,
        include_deleted: bool = False,
        limit: int = 50,
    ) -> list[dict]:
        fts_q = self._build_query(query)
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


# Active backend. Defaults to FTS5 (the only supported engine today); a fresh
# instance is also fine since backends are stateless. select_backend() can
# re-pick it for the bound engine at boot.
_backend: SearchBackend = Fts5Backend()


def select_backend() -> None:
    """Choose the search backend for the bound engine. Idempotent.

    Called once from create_app() after db.init_app(). SQLite resolves to the
    FTS5 backend (the live path); any other dialect (i.e. the future Postgres
    tier) has no backend yet, so we fail loudly rather than silently leave the
    index unmaintained — matching the engine stub in app/database.py.
    """
    global _backend
    dialect = db.engine.dialect.name
    if dialect == "sqlite":
        _backend = Fts5Backend()
        return
    raise NotImplementedError(
        f"No full-text search backend for the {dialect!r} engine yet "
        "(roadmap Phase 7b: Postgres tsvector + GIN)."
    )


# --- Public interface -------------------------------------------------------
# Thin delegators to the active backend. Callers (create_app, the notes route,
# the mapper events below) only ever touch these, never a backend directly.

def ensure_fts_table() -> None:
    _backend.ensure_schema()


def index_note(connection, note: Note) -> None:
    _backend.index(connection, note)


def unindex_note(connection, note_id: str) -> None:
    _backend.unindex(connection, note_id)


def search_notes(
    user_id: str,
    query: str,
    *,
    include_deleted: bool = False,
    limit: int = 50,
) -> list[dict]:
    """Return up to ``limit`` ranked hits for ``user_id``.

    Each hit is ``{note_id, raw_snippet, markdown_snippet}``; the caller
    hydrates note metadata from the ORM and applies the ``is_deleted`` filter.
    """
    return _backend.search(
        user_id, query, include_deleted=include_deleted, limit=limit
    )


# --- Sync listeners ---------------------------------------------------------
# Mapper-level events fire during flush, inside the same transaction as the
# Note write, so the index is committed atomically with the ORM change.

@event.listens_for(Note, "after_insert")
def _note_after_insert(mapper, connection, target):
    index_note(connection, target)


@event.listens_for(Note, "after_update")
def _note_after_update(mapper, connection, target):
    # Only re-index when indexed text actually changed. Skipping no-op updates
    # (touching only updated_at, version, is_deleted, etc.) keeps the index
    # from churning unnecessarily.
    state = inspect(target)
    raw_hist = state.attrs.note_content_raw.history
    md_hist = state.attrs.note_content_markdown.history
    if not (raw_hist.has_changes() or md_hist.has_changes()):
        return
    index_note(connection, target)


@event.listens_for(Note, "after_delete")
def _note_after_delete(mapper, connection, target):
    unindex_note(connection, target.id)
