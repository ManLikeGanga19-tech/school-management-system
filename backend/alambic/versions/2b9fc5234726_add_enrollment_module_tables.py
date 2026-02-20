"""add enrollment module tables

Revision ID: 2b9fc5234726
Revises: 677ab8f8f0e3
Create Date: 2026-02-12 19:27:31.928148

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '2b9fc5234726'
down_revision: Union[str, None] = '677ab8f8f0e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS enrollment")

    op.create_table(
        "enrollments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default=sa.text("'DRAFT'")),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        schema="enrollment",
    )

    op.create_index(
        "ix_enrollment_enrollments_tenant_status",
        "enrollments",
        ["tenant_id", "status"],
        unique=False,
        schema="enrollment",
    )


def downgrade() -> None:
    op.drop_index("ix_enrollment_enrollments_tenant_status", table_name="enrollments", schema="enrollment")
    op.drop_table("enrollments", schema="enrollment")