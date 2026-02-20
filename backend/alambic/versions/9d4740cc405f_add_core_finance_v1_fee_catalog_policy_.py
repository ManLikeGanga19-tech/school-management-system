"""add core finance v1 (fee catalog, policy, fee structures, scholarships, invoices and payments)

Revision ID: 9d4740cc405f
Revises: d8a5483cb60d
Create Date: 2026-02-13 10:23:07.542190

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '9d4740cc405f'
down_revision: Union[str, None] = 'd8a5483cb60d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    # -------------------------
    # Finance Policy (per tenant)
    # -------------------------
    op.create_table(
        "finance_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False, unique=True),

        sa.Column("allow_partial_enrollment", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("min_percent_to_enroll", sa.Integer(), nullable=True),
        sa.Column("min_amount_to_enroll", sa.Numeric(12, 2), nullable=True),

        sa.Column("require_interview_fee_before_submit", sa.Boolean(), nullable=False, server_default=sa.text("true")),

        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        schema="core",
    )

    # -------------------------
    # Fee Catalog
    # -------------------------
    op.create_table(
        "fee_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(60), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_fee_categories_tenant_code"),
        schema="core",
    )

    op.create_table(
        "fee_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.fee_categories.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("code", sa.String(60), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_fee_items_tenant_code"),
        schema="core",
    )

    # -------------------------
    # Fee Structures (per class_code)
    # -------------------------
    op.create_table(
        "fee_structures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_code", sa.String(50), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "class_code", name="uq_fee_structures_tenant_class"),
        schema="core",
    )

    op.create_table(
        "fee_structure_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("structure_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.fee_structures.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fee_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.fee_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.UniqueConstraint("structure_id", "fee_item_id", name="uq_fee_structure_item"),
        schema="core",
    )

    # -------------------------
    # Scholarships (tenant)
    # -------------------------
    op.create_table(
        "scholarships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),  # PERCENT|FIXED
        sa.Column("value", sa.Numeric(12, 2), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "name", name="uq_scholarships_tenant_name"),
        schema="core",
    )

    # -------------------------
    # Invoices + lines
    # -------------------------
    op.create_table(
        "invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),

        sa.Column("invoice_no", sa.String(50), nullable=True),
        sa.Column("invoice_type", sa.String(30), nullable=False),  # INTERVIEW|SCHOOL_FEES
        sa.Column("status", sa.String(30), nullable=False, server_default=sa.text("'DRAFT'")),

        # For now: tie invoice to enrollment until Students table exists
        sa.Column("enrollment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.enrollments.id", ondelete="SET NULL"), nullable=True),

        sa.Column("currency", sa.String(10), nullable=False, server_default=sa.text("'KES'")),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("paid_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("balance_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),

        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        schema="core",
    )

    op.create_table(
        "invoice_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="core",
    )

    # -------------------------
    # Payments + allocations
    # -------------------------
    op.create_table(
        "payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),

        sa.Column("provider", sa.String(30), nullable=False),  # CASH|MPESA|BANK|CHEQUE
        sa.Column("reference", sa.String(100), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(10), nullable=False, server_default=sa.text("'KES'")),

        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema="core",
    )

    op.create_table(
        "payment_allocations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.payments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.UniqueConstraint("payment_id", "invoice_id", name="uq_payment_invoice_alloc"),
        schema="core",
    )


def downgrade() -> None:
    op.drop_table("payment_allocations", schema="core")
    op.drop_table("payments", schema="core")
    op.drop_table("invoice_lines", schema="core")
    op.drop_table("invoices", schema="core")
    op.drop_table("scholarships", schema="core")
    op.drop_table("fee_structure_items", schema="core")
    op.drop_table("fee_structures", schema="core")
    op.drop_table("fee_items", schema="core")
    op.drop_table("fee_categories", schema="core")
    op.drop_table("finance_policies", schema="core")
