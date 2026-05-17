"""add organization table and user.organization_id

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-05-17 12:00:00.000000

Adds the Organization entity — a one-row-per-install practice/clinic the
admin sets during first-run setup and every user inherits.

The organization table is hand-written with IF NOT EXISTS: db.create_all()
will already have created it on any boot since the model was registered, so
this stays idempotent on existing databases (it just advances the Alembic
pointer). The user.organization_id column genuinely needs the ALTER —
create_all() never alters an existing table — so it goes through
batch_alter_table, matching the other user-column migrations.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c0d1e2f3a4b5'
down_revision = 'b9c0d1e2f3a4'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS organization (
            id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            created_at DATETIME,
            PRIMARY KEY (id)
        )
        """
    )
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'organization_id',
                sa.String(length=36),
                sa.ForeignKey('organization.id'),
                nullable=True,
            )
        )


def downgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('organization_id')
    op.drop_table('organization')
