"""add organization_id to PHI tables (tenant boundary)

Revision ID: b3f1a9c7e2d4
Revises: a3c5e7b9d1f4
Create Date: 2026-05-24 12:00:00.000000

Denormalizes the tenant boundary (Phase 8) onto every PHI-bearing table —
note, template, participant, audio_file, note_addendum, audit_log — so
cross-org filtering is a direct indexed column rather than a join through the
author. The column is nullable (standalone and legacy rows may have no org)
and stamped on insert by services/org_stamp.py going forward.

On a fresh boot db.create_all() already creates these columns + indexes from
the models, so this migration only matters for existing databases brought up
with `flask db upgrade` (fresh installs stamp the head). The backfill is
idempotent (guarded by `organization_id IS NULL`).

Backfill order matters: org-less users are first adopted into the install's
organization when exactly one exists (mirroring routes/organization.py), so
their rows then inherit a real org in the per-table backfills that follow.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b3f1a9c7e2d4'
down_revision = 'a3c5e7b9d1f4'
branch_labels = None
depends_on = None

# PHI tables that get organization_id, paired with the column holding the
# owning user id used to backfill it.
_AUTHOR_TABLES = [
    ('note', 'author_id'),
    ('template', 'author_id'),
    ('participant', 'author_id'),
    ('audio_file', 'author_id'),
    ('note_addendum', 'author_id'),
]
_ALL_TABLES = [t for t, _ in _AUTHOR_TABLES] + ['audit_log']


def upgrade():
    # 1. Add the column + matching index to each table. Index name matches what
    #    create_all() generates from index=True, so fresh and migrated DBs agree.
    for table in _ALL_TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    'organization_id',
                    sa.String(length=36),
                    sa.ForeignKey('organization.id'),
                    nullable=True,
                )
            )
        op.create_index(
            op.f(f'ix_{table}_organization_id'), table, ['organization_id']
        )

    # 2. Adopt org-less users into the install's organization when exactly one
    #    exists. No-op for zero orgs (pure standalone) or multiple orgs (a
    #    backfill can't disambiguate; new orgs assign on creation going forward).
    op.execute(
        """
        UPDATE "user" SET organization_id = (SELECT id FROM organization LIMIT 1)
        WHERE organization_id IS NULL
          AND (SELECT COUNT(*) FROM organization) = 1
        """
    )

    # 3. Backfill each author-owned PHI table from its author's organization.
    for table, owner_col in _AUTHOR_TABLES:
        op.execute(
            f"""
            UPDATE {table} SET organization_id =
                (SELECT u.organization_id FROM "user" u WHERE u.id = {table}.{owner_col})
            WHERE organization_id IS NULL
            """
        )

    # 4. Backfill audit rows from the acting user; system / failed-login rows
    #    (user_id NULL) intentionally stay org-less.
    op.execute(
        """
        UPDATE audit_log SET organization_id =
            (SELECT u.organization_id FROM "user" u WHERE u.id = audit_log.user_id)
        WHERE organization_id IS NULL AND user_id IS NOT NULL
        """
    )


def downgrade():
    for table in _ALL_TABLES:
        op.drop_index(op.f(f'ix_{table}_organization_id'), table_name=table)
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column('organization_id')
