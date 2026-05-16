"""add speaker_labels to note

Revision ID: f1a2b3c4d5e6
Revises: eaeb8d15eeea
Create Date: 2026-05-15 14:00:00.000000

Adds the manual speaker->identity mapping layered over note_content_segments.
Nullable so existing rows remain valid — an unlabeled note simply renders
the raw "Speaker N" diarization labels.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'eaeb8d15eeea'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('note', schema=None) as batch_op:
        batch_op.add_column(sa.Column('speaker_labels', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('note', schema=None) as batch_op:
        batch_op.drop_column('speaker_labels')
