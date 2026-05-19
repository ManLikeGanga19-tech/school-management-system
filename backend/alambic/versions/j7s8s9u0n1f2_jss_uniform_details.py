"""drop uniform_requirements, add JSS uniform details to payment settings

Revision ID: j7s8s9u0n1f2
Revises: u1n2i3f4o5r6
Create Date: 2026-05-19 00:00:00.000000

The standalone uniform_requirements table was the wrong model: uniform
information is held on the tenant payment settings and printed on the fee
structure sheet. Only Junior Secondary (Grade 7/8/9) needs different
instructions, so this drops that table and adds a single JSS uniform text
field alongside the existing uniform_details_text.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "j7s8s9u0n1f2"
down_revision = "u1n2i3f4o5r6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenant_payment_settings",
        sa.Column("uniform_details_text_jss", sa.Text(), nullable=True),
        schema="core",
    )
    op.drop_index(
        "ix_uniform_requirements_tenant_class",
        table_name="uniform_requirements",
        schema="core",
    )
    op.drop_table("uniform_requirements", schema="core")


def downgrade() -> None:
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
    op.drop_column("tenant_payment_settings", "uniform_details_text_jss", schema="core")
