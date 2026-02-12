"""add core audit log tables

Revision ID: 6ac369d9e120
Revises: b3cf191df361
Create Date: 2026-02-12 10:25:21.312266

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '6ac369d9e120'
down_revision: Union[str, None] = 'b3cf191df361'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.users.id", ondelete="SET NULL"), nullable=True),

        sa.Column("action", sa.String(length=150), nullable=False),
        sa.Column("resource", sa.String(length=120), nullable=False),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=True),

        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),

        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),

        schema="core",
    )

    op.create_index("ix_audit_logs_tenant_created_at", "audit_logs", ["tenant_id", "created_at"], schema="core")
    op.create_index("ix_audit_logs_tenant_action", "audit_logs", ["tenant_id", "action"], schema="core")
    op.create_index("ix_audit_logs_tenant_resource", "audit_logs", ["tenant_id", "resource"], schema="core")
    op.create_index("ix_audit_logs_tenant_resource_id", "audit_logs", ["tenant_id", "resource_id"], schema="core")


def downgrade() -> None:
    op.drop_index("ix_audit_logs_tenant_resource_id", table_name="audit_logs", schema="core")
    op.drop_index("ix_audit_logs_tenant_resource", table_name="audit_logs", schema="core")
    op.drop_index("ix_audit_logs_tenant_action", table_name="audit_logs", schema="core")
    op.drop_index("ix_audit_logs_tenant_created_at", table_name="audit_logs", schema="core")
    op.drop_table("audit_logs", schema="core")