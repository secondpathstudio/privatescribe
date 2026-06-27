"""Additive schema reconciliation for create_all()-born databases.

``db.create_all()`` runs on every boot (in ``create_app``) and creates any
missing *table*, but it never adds a new *column* to a table that already
exists. A database first created by an older build therefore lacks every
column added to a pre-existing table since — most consequentially
``organization_id`` on the PHI tables (added in 2.0). Without that column,
every ORM query against those tables fails with
``no such column: <table>.organization_id``, which is what broke template
creation (and reads) for users upgrading in place from 1.0.

This walks the model metadata and, for each table that already exists, issues
an idempotent ``ALTER TABLE ... ADD COLUMN`` for any column the live table is
missing, then ``CREATE INDEX IF NOT EXISTS`` for any missing index. It is
purely additive — it never drops or alters an existing column — so it is safe
to run on every boot and is a no-op once the schema matches.

This is a permanent self-heal for *additive* drift, not a migration system: it
cannot do backfills, renames, drops, or type changes. The Alembic migrations
under ``migrations/`` remain the source of truth for those; running
``flask db upgrade`` on boot (which also requires bundling ``migrations/`` into
the packaged binary and solving the legacy-baseline stamp) is the tracked
follow-up that will demote this to a thin "born before Alembic" bootstrap.
"""
import logging

from sqlalchemy import inspect, text

from app.extensions import db

logger = logging.getLogger(__name__)


def reconcile_schema() -> list[str]:
    """Add any model column/index missing from the live database.

    Returns the list of changes applied (empty when the schema already
    matched). Best-effort per object: a failure on one column or index is
    logged and skipped rather than aborting boot.
    """
    engine = db.engine
    dialect = engine.dialect
    inspector = inspect(engine)
    live_tables = set(inspector.get_table_names())
    applied: list[str] = []

    for table in db.metadata.sorted_tables:
        if table.name not in live_tables:
            # A brand-new table — create_all() already created it in full.
            continue

        live_cols = {c["name"] for c in inspector.get_columns(table.name)}
        changed = False
        for column in table.columns:
            if column.name in live_cols:
                continue
            ddl = _add_column_ddl(table.name, column, dialect)
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
                applied.append(f"column {table.name}.{column.name}")
                changed = True
                logger.warning(
                    "schema reconcile: added missing column %s.%s",
                    table.name, column.name,
                )
            except Exception as e:  # noqa: BLE001 - a heal must never abort boot
                logger.error(
                    "schema reconcile: could not add column %s.%s (%s): %s",
                    table.name, column.name, type(e).__name__, e,
                )

        # Re-inspect after column adds so index creation sees the new columns.
        if changed:
            inspector = inspect(engine)
            live_cols = {c["name"] for c in inspector.get_columns(table.name)}
        live_indexes = {
            ix["name"] for ix in inspector.get_indexes(table.name) if ix.get("name")
        }

        for index in table.indexes:
            if not index.name or index.name in live_indexes:
                continue
            cols = [c.name for c in index.columns]
            if not cols or not all(c in live_cols for c in cols):
                # An index whose column we couldn't add — skip it rather than
                # emit DDL that would fail.
                continue
            unique = "UNIQUE " if index.unique else ""
            col_list = ", ".join(f'"{c}"' for c in cols)
            ddl = (
                f'CREATE {unique}INDEX IF NOT EXISTS "{index.name}" '
                f'ON "{table.name}" ({col_list})'
            )
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
                applied.append(f"index {index.name}")
                logger.warning("schema reconcile: created missing index %s", index.name)
            except Exception as e:  # noqa: BLE001
                logger.error(
                    "schema reconcile: could not create index %s (%s): %s",
                    index.name, type(e).__name__, e,
                )

    if applied:
        logger.warning(
            "schema reconcile: applied %d change(s) to bring the database up to "
            "the current model schema: %s",
            len(applied), ", ".join(applied),
        )
    return applied


def _add_column_ddl(table_name: str, column, dialect) -> str:
    """Compile a single additive ``ALTER TABLE ... ADD COLUMN`` statement.

    The column type is compiled for the live dialect; the foreign-key clause is
    intentionally dropped (SQLite can't add an FK to an existing table and we
    don't need DB-level enforcement — the column just has to exist for the ORM).
    ``NOT NULL`` is emitted only when a constant default is available, since
    SQLite rejects adding a ``NOT NULL`` column to a populated table without
    one; otherwise the column is added nullable and the ORM supplies the value
    on insert.
    """
    col_type = column.type.compile(dialect=dialect)
    ddl = f'ALTER TABLE "{table_name}" ADD COLUMN "{column.name}" {col_type}'

    default_sql = _constant_default_sql(column)
    if column.nullable is False and default_sql is not None:
        ddl += f" NOT NULL DEFAULT {default_sql}"
    elif default_sql is not None:
        ddl += f" DEFAULT {default_sql}"
    # else: add as a plain nullable column.
    return ddl


def _constant_default_sql(column):
    """Render a column's constant default as a SQL literal, or ``None``.

    Only scalar (non-callable) Python-side defaults and simple server defaults
    are rendered; callables (uuid4, utcnow) can't be expressed as a constant
    here and fall through to a nullable add.
    """
    server_default = column.server_default
    if server_default is not None and getattr(server_default, "arg", None) is not None:
        arg = server_default.arg
        return arg.text if hasattr(arg, "text") else str(arg)

    default = column.default
    if default is None or not getattr(default, "is_scalar", False):
        return None
    val = default.arg
    if isinstance(val, bool):
        return "1" if val else "0"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        return "'" + val.replace("'", "''") + "'"
    return None
