"""add plan_code (tier) to subscriptions

The existing subscriptions.plan column holds the *billing plan*
(per_term / per_year). plan_code is the *tier* (basic / standard /
premium) and references subscription_plans.code — it is what drives
module gating, kept separate so the billing subsystem is untouched.

Revision ID: t2i3e4r5c6d7
Revises: s1p2l3a4n5b6
Create Date: 2026-05-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "t2i3e4r5c6d7"
down_revision = "s1p2l3a4n5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "subscriptions",
        sa.Column("plan_code", sa.String(length=64), nullable=True),
        schema="core",
    )
    op.create_index(
        "ix_core_subscriptions_plan_code",
        "subscriptions",
        ["plan_code"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_core_subscriptions_plan_code", table_name="subscriptions", schema="core")
    op.drop_column("subscriptions", "plan_code", schema="core")
