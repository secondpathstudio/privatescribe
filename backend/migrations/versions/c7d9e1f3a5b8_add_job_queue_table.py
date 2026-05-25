"""add job queue table (Phase 13)

Revision ID: c7d9e1f3a5b8
Revises: b3f1a9c7e2d4
Create Date: 2026-05-24

Background job queue: a `job` row per queued transcription, processed by an
in-process worker thread that writes a draft note. Org-stamped like the other
PHI tables. `db.create_all()` creates this on a fresh boot; this migration
brings existing databases in step.
"""
from alembic import op
import sqlalchemy as sa


revision = 'c7d9e1f3a5b8'
down_revision = 'b3f1a9c7e2d4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'job',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('author_id', sa.String(length=36), nullable=False),
        sa.Column('organization_id', sa.String(length=36), nullable=True),
        sa.Column('type', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('audio_file_id', sa.String(length=36), nullable=True),
        sa.Column('diarize', sa.Boolean(), nullable=False, server_default=sa.false()),
        # JSON lists — a recording fans out into one note per template.
        sa.Column('template_ids', sa.JSON(), nullable=True),
        sa.Column('note_ids', sa.JSON(), nullable=True),
        sa.Column('progress', sa.Integer(), nullable=False),
        sa.Column('stage', sa.String(length=64), nullable=True),
        sa.Column('error_text', sa.Text(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('label', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['author_id'], ['user.id']),
        sa.ForeignKeyConstraint(['organization_id'], ['organization.id']),
        sa.ForeignKeyConstraint(['audio_file_id'], ['audio_file.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_job_author_id'), ['author_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_job_organization_id'), ['organization_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_job_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_job_audio_file_id'), ['audio_file_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_job_created_at'), ['created_at'], unique=False)


def downgrade():
    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_job_created_at'))
        batch_op.drop_index(batch_op.f('ix_job_audio_file_id'))
        batch_op.drop_index(batch_op.f('ix_job_status'))
        batch_op.drop_index(batch_op.f('ix_job_organization_id'))
        batch_op.drop_index(batch_op.f('ix_job_author_id'))
    op.drop_table('job')
