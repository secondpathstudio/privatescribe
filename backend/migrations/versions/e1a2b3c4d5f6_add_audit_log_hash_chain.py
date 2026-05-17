"""add hash-chain tamper-evidence to audit_log

Revision ID: e1a2b3c4d5f6
Revises: c0d1e2f3a4b5
Create Date: 2026-05-17 14:00:00.000000

GAP-07 remediation — makes the audit log tamper-evident:

  - seq / prev_hash / entry_hash columns on audit_log form an HMAC hash
    chain (keyed by AUDIT_HMAC_KEY; see app/services/audit.py). Editing or
    deleting a row breaks the chain, which `flask verify-audit-log` detects.
  - Existing rows are backfilled with a seq (in created_at order) so every
    row has a stable chain position, but keep prev_hash/entry_hash NULL:
    rows written before the chain existed cannot be signed retroactively.
  - BEFORE UPDATE / BEFORE DELETE triggers on audit_log and key_export_log
    reject mutation at the DB layer — defense-in-depth against accidental
    or casual tampering.

The columns and triggers are also created by create_app() (db.create_all()
plus audit.ensure_audit_triggers()) on fresh boots, so both paths are
idempotent — this migration brings pre-existing databases into step.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e1a2b3c4d5f6'
down_revision = 'c0d1e2f3a4b5'
branch_labels = None
depends_on = None


_AUDIT_TABLES = ('audit_log', 'key_export_log')


def upgrade():
    # Drop any pre-existing triggers first so the backfill UPDATE below isn't
    # blocked by them (a boot on the new code installs them via create_app).
    for table in _AUDIT_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS {table}_no_update")
        op.execute(f"DROP TRIGGER IF EXISTS {table}_no_delete")

    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.add_column(sa.Column('seq', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('prev_hash', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('entry_hash', sa.String(length=64), nullable=True))
        batch_op.create_index('ix_audit_log_seq', ['seq'], unique=True)

    # Backfill seq in (created_at, id) order so every existing row has a
    # stable chain position. prev_hash/entry_hash stay NULL by design.
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id FROM audit_log ORDER BY created_at, id")
    ).fetchall()
    for i, row in enumerate(rows, start=1):
        conn.execute(
            sa.text("UPDATE audit_log SET seq = :seq WHERE id = :id"),
            {"seq": i, "id": row[0]},
        )

    # Append-only triggers. IF NOT EXISTS keeps this idempotent against a
    # database where create_app() already installed them.
    for table in _AUDIT_TABLES:
        for op_kind in ('UPDATE', 'DELETE'):
            name = f"{table}_no_{op_kind.lower()}"
            op.execute(
                f"CREATE TRIGGER IF NOT EXISTS {name} "
                f"BEFORE {op_kind} ON {table} "
                f"BEGIN SELECT RAISE(ABORT, '{table} is append-only'); END"
            )


def downgrade():
    for table in _AUDIT_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS {table}_no_update")
        op.execute(f"DROP TRIGGER IF EXISTS {table}_no_delete")

    # Drop the index before the batch recreate — otherwise batch reflection
    # tries to rebuild it on a table that no longer has the `seq` column.
    op.execute("DROP INDEX IF EXISTS ix_audit_log_seq")

    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.drop_column('entry_hash')
        batch_op.drop_column('prev_hash')
        batch_op.drop_column('seq')
