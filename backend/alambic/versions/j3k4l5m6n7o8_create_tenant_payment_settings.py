"""create tenant_payment_settings table

Revision ID: j3k4l5m6n7o8
Revises: i2j3k4l5m6n7
Create Date: 2026-03-30 08:15:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "j3k4l5m6n7o8"
down_revision: Union[str, None] = "i2j3k4l5m6n7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_payment_settings",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # M-PESA fields
        sa.Column("mpesa_paybill", sa.String(30), nullable=True),
        sa.Column("mpesa_business_no", sa.String(30), nullable=True),
        sa.Column("mpesa_account_format", sa.String(120), nullable=True),  # e.g. "Admission No."
        # Bank details
        sa.Column("bank_name", sa.String(120), nullable=True),
        sa.Column("bank_account_name", sa.String(160), nullable=True),
        sa.Column("bank_account_number", sa.String(60), nullable=True),
        sa.Column("bank_branch", sa.String(120), nullable=True),
        # School fees cash policy text
        sa.Column("cash_payment_instructions", sa.Text(), nullable=True),
        # Uniform details block (printed on fee structure sheet)
        sa.Column("uniform_details_text", sa.Text(), nullable=True),
        # Assessment books
        sa.Column("assessment_books_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("assessment_books_note", sa.String(200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        schema="core",
    )


def downgrade() -> None:
    op.drop_table("tenant_payment_settings", schema="core")
