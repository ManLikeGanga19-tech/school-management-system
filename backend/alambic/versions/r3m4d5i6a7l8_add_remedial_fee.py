"""add remedial_fee_amount to tenant payment settings

Revision ID: r3m4d5i6a7l8
Revises: j7s8s9u0n1f2
Create Date: 2026-05-19 00:00:00.000000

A flat per-term remedial fee, configured on the payment settings and
printed on the fee structure sheet for Junior Secondary (Grade 7/8/9)
classes only.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "r3m4d5i6a7l8"
down_revision = "j7s8s9u0n1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenant_payment_settings",
        sa.Column("remedial_fee_amount", sa.Numeric(12, 2), nullable=True),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("tenant_payment_settings", "remedial_fee_amount", schema="core")
