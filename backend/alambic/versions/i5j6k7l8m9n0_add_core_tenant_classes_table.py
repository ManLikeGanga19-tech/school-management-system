"""add core tenant classes table

Revision ID: i5j6k7l8m9n0
Revises: h4i5j6k7l8m9
Create Date: 2026-02-26 12:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "i5j6k7l8m9n0"
down_revision: Union[str, None] = "h4i5j6k7l8m9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "tenant_classes",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_tenant_classes_tenant_code"),
        schema="core",
    )

    op.create_index(
        "ix_tenant_classes_tenant_active",
        "tenant_classes",
        ["tenant_id", "is_active"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_tenant_classes_tenant_name",
        "tenant_classes",
        ["tenant_id", "name"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_tenant_classes_tenant_name", table_name="tenant_classes", schema="core")
    op.drop_index("ix_tenant_classes_tenant_active", table_name="tenant_classes", schema="core")
    op.drop_table("tenant_classes", schema="core")
