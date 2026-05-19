"""add uniform_requirements table

Revision ID: u1n2i3f4o5r6
Revises: a9f3d1c7b8e1, c4l5o6g7e8n9, f1a2b3c4d5e6, gg2hh3ii4jj5
Create Date: 2026-05-19 00:00:00.000000

Merges the four open heads and adds the uniform_requirements table — a
structured, class-level uniform list (item, quantity, unit price, mandatory
flag) that the fees invoice draws from.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "u1n2i3f4o5r6"
down_revision = ("a9f3d1c7b8e1", "c4l5o6g7e8n9", "f1a2b3c4d5e6", "gg2hh3ii4jj5")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uniform_requirements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_code", sa.String(length=50), nullable=False),
        sa.Column("item_name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("is_mandatory", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        schema="core",
    )
    op.create_index(
        "ix_uniform_requirements_tenant_class",
        "uniform_requirements",
        ["tenant_id", "class_code"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_uniform_requirements_tenant_class", table_name="uniform_requirements", schema="core")
    op.drop_table("uniform_requirements", schema="core")
