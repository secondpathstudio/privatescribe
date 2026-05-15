"""add note status, signed_at, and note_addendum table

Revision ID: eaeb8d15eeea
Revises: 21f60e821083
Create Date: 2026-05-15 13:51:07.773349

Adds the note workflow state (draft/finalized/signed) plus the
append-only note_addendum table.

`status` is NOT NULL with server_default 'draft' so existing rows
backfill cleanly — every pre-feature note becomes a draft.

Idempotent on purpose: this project also runs db.create_all() inside
create_app(), which creates *new tables* (note_addendum) on boot before
`flask db upgrade` ever runs. So upgrade() inspects the live schema and
only applies what's actually missing — safe whether create_all got there
first or not. Autogenerate's spurious notes_fts5 drops are omitted (those
virtual tables are managed by raw SQL in migration a09f8b7c6d5e).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'eaeb8d15eeea'
down_revision = '21f60e821083'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    note_cols = {c['name'] for c in insp.get_columns('note')}
    tables = set(insp.get_table_names())

    add_status = 'status' not in note_cols
    add_signed = 'signed_at' not in note_cols
    if add_status or add_signed:
        with op.batch_alter_table('note', schema=None) as batch_op:
            if add_status:
                batch_op.add_column(sa.Column(
                    'status', sa.String(length=20),
                    nullable=False, server_default='draft',
                ))
            if add_signed:
                batch_op.add_column(sa.Column('signed_at', sa.DateTime(), nullable=True))

    if 'note_addendum' not in tables:
        op.create_table(
            'note_addendum',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('note_id', sa.String(length=36), nullable=False),
            sa.Column('author_id', sa.String(length=36), nullable=False),
            sa.Column('author_name', sa.String(length=100), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['note_id'], ['note.id']),
            sa.ForeignKeyConstraint(['author_id'], ['user.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('note_addendum', schema=None) as batch_op:
            batch_op.create_index(
                batch_op.f('ix_note_addendum_note_id'), ['note_id'], unique=False,
            )


def downgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'note_addendum' in set(insp.get_table_names()):
        op.drop_table('note_addendum')

    note_cols = {c['name'] for c in insp.get_columns('note')}
    if 'signed_at' in note_cols or 'status' in note_cols:
        with op.batch_alter_table('note', schema=None) as batch_op:
            if 'signed_at' in note_cols:
                batch_op.drop_column('signed_at')
            if 'status' in note_cols:
                batch_op.drop_column('status')
