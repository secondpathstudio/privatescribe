"""fix UUID FK column types

Revision ID: c4f0d1a2b3e5
Revises: b2d4f6a8c1e2
Create Date: 2026-05-11 00:00:00.000000

Two foreign-key columns were declared INTEGER but reference String(36) UUID
primary keys: `note.template_id` -> `template.id`, and `note_participants.note_id`
-> `note.id`. SQLite's loose type affinity stored the UUIDs as TEXT regardless,
so existing data is intact — only the declared column type is wrong. This
migration rewrites the schema to match. Stricter databases (Postgres/MySQL)
would have rejected the original DDL.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c4f0d1a2b3e5'
down_revision = 'b2d4f6a8c1e2'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('note', schema=None) as batch_op:
        batch_op.alter_column(
            'template_id',
            existing_type=sa.Integer(),
            type_=sa.String(length=36),
            existing_nullable=True,
        )

    with op.batch_alter_table('note_participants', schema=None) as batch_op:
        batch_op.alter_column(
            'note_id',
            existing_type=sa.Integer(),
            type_=sa.String(length=36),
            existing_nullable=False,
        )


def downgrade():
    with op.batch_alter_table('note_participants', schema=None) as batch_op:
        batch_op.alter_column(
            'note_id',
            existing_type=sa.String(length=36),
            type_=sa.Integer(),
            existing_nullable=False,
        )

    with op.batch_alter_table('note', schema=None) as batch_op:
        batch_op.alter_column(
            'template_id',
            existing_type=sa.String(length=36),
            type_=sa.Integer(),
            existing_nullable=True,
        )
