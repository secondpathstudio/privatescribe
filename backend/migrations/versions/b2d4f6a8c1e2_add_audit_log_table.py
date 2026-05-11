"""add audit_log table

Revision ID: b2d4f6a8c1e2
Revises: a1f2c3d4e5b6
Create Date: 2026-05-10 12:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b2d4f6a8c1e2'
down_revision = 'a1f2c3d4e5b6'
branch_labels = None
depends_on = None


def upgrade():
    # Hand-written: db.create_all() will have already added this table on any
    # boot since the AuditLog model was registered, so use IF NOT EXISTS to
    # make the migration idempotent on existing dev databases.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36),
            user_email VARCHAR(255),
            action VARCHAR(64) NOT NULL,
            resource_type VARCHAR(32),
            resource_id VARCHAR(64),
            status VARCHAR(16) NOT NULL,
            ip_address VARCHAR(64),
            user_agent VARCHAR(512),
            extra_data JSON,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(user_id) REFERENCES user (id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_user_id ON audit_log (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_action ON audit_log (action)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_resource_type ON audit_log (resource_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_resource_id ON audit_log (resource_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_created_at ON audit_log (created_at)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_audit_log_created_at")
    op.execute("DROP INDEX IF EXISTS ix_audit_log_resource_id")
    op.execute("DROP INDEX IF EXISTS ix_audit_log_resource_type")
    op.execute("DROP INDEX IF EXISTS ix_audit_log_action")
    op.execute("DROP INDEX IF EXISTS ix_audit_log_user_id")
    op.drop_table('audit_log')
