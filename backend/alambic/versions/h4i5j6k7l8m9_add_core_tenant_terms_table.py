"""add core tenant terms table

Revision ID: h4i5j6k7l8m9
Revises: caf39e317ac7
Create Date: 2026-02-26 11:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "h4i5j6k7l8m9"
down_revision: Union[str, None] = "caf39e317ac7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "tenant_terms",
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
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_tenant_terms_tenant_code"),
        schema="core",
    )

    op.create_index(
        "ix_tenant_terms_tenant_active",
        "tenant_terms",
        ["tenant_id", "is_active"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_tenant_terms_tenant_name",
        "tenant_terms",
        ["tenant_id", "name"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_tenant_terms_tenant_name", table_name="tenant_terms", schema="core")
    op.drop_index("ix_tenant_terms_tenant_active", table_name="tenant_terms", schema="core")
    op.drop_table("tenant_terms", schema="core")
