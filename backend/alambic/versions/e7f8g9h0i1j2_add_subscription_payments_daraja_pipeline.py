"""add subscription payments daraja pipeline table

Revision ID: e7f8g9h0i1j2
Revises: d6e7f8g9h0i1
Create Date: 2026-03-03 20:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e7f8g9h0i1j2"
down_revision: Union[str, None] = "d6e7f8g9h0i1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscription_payments",
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
        sa.Column(
            "subscription_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.subscriptions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("initiated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default=sa.text("'MPESA_DARAJA'")),
        sa.Column("phone_number", sa.String(length=20), nullable=False),
        sa.Column("amount_kes", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default=sa.text("'KES'")),
        sa.Column("checkout_request_id", sa.String(length=120), nullable=False),
        sa.Column("merchant_request_id", sa.String(length=120), nullable=True),
        sa.Column("mpesa_receipt", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'PENDING'")),
        sa.Column("result_code", sa.Integer(), nullable=True),
        sa.Column("result_desc", sa.Text(), nullable=True),
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("callback_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("initiated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_subscription_payments_status",
        ),
        sa.UniqueConstraint("checkout_request_id", name="uq_subscription_payments_checkout_request_id"),
        schema="core",
    )

    op.create_index(
        "ix_subscription_payments_tenant_initiated",
        "subscription_payments",
        ["tenant_id", "initiated_at"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_subscription_payments_subscription_initiated",
        "subscription_payments",
        ["subscription_id", "initiated_at"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_subscription_payments_status_initiated",
        "subscription_payments",
        ["status", "initiated_at"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_subscription_payments_status_initiated",
        table_name="subscription_payments",
        schema="core",
    )
    op.drop_index(
        "ix_subscription_payments_subscription_initiated",
        table_name="subscription_payments",
        schema="core",
    )
    op.drop_index(
        "ix_subscription_payments_tenant_initiated",
        table_name="subscription_payments",
        schema="core",
    )
    op.drop_table("subscription_payments", schema="core")
