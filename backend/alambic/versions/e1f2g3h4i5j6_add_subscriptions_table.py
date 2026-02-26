"""add subscriptions table

Revision ID: e1f2g3h4i5j6
Revises: d8a5483cb60d
Create Date: 2026-02-23 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e1f2g3h4i5j6'
down_revision: Union[str, None] = 'd8a5483cb60d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")
    
    # subscriptions table
    op.create_table(
        "subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan", sa.String(64), nullable=False),
        sa.Column("billing_cycle", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'trialing'")),
        sa.Column("amount_kes", sa.Numeric(12, 2), nullable=False),
        sa.Column("discount_percent", sa.Numeric(5, 2), server_default=sa.text("0.0")),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("billing_cycle IN ('per_term', 'full_year')", name="ck_subscriptions_billing_cycle"),
        sa.CheckConstraint("status IN ('active', 'trialing', 'past_due', 'cancelled', 'paused')", name="ck_subscriptions_status"),
        schema="core",
    )
    
    # Create indexes
    op.create_index("idx_subscriptions_tenant_id", "subscriptions", ["tenant_id"], schema="core")
    op.create_index("idx_subscriptions_status", "subscriptions", ["status"], schema="core")


def downgrade() -> None:
    op.drop_index("idx_subscriptions_status", schema="core")
    op.drop_index("idx_subscriptions_tenant_id", schema="core")
    op.drop_table("subscriptions", schema="core")
