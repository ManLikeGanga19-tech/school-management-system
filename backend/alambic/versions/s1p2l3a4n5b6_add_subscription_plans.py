"""add subscription_plans catalogue

Creates the DB-driven plan catalogue for subscription module gating and
seeds the default Basic / Standard / Premium tiers. Each plan lists the
gateable modules it unlocks; core modules are always available.

Also merges the two open heads (d0e1f2g3h4i5, f1a2b3c4d5e6).

Revision ID: s1p2l3a4n5b6
Revises: d0e1f2g3h4i5, f1a2b3c4d5e6
Create Date: 2026-05-17 00:00:00.000000

"""
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "s1p2l3a4n5b6"
down_revision = ("d0e1f2g3h4i5", "f1a2b3c4d5e6")
branch_labels = None
depends_on = None


_SEED_PLANS = [
    {
        "code": "basic",
        "name": "Basic",
        "modules": [],
        "price_kes": 0,
        "grace_days": 14,
        "sort_order": 1,
    },
    {
        "code": "standard",
        "name": "Standard",
        "modules": ["exams", "cbc", "igcse", "discipline", "events"],
        "price_kes": 0,
        "grace_days": 14,
        "sort_order": 2,
    },
    {
        "code": "premium",
        "name": "Premium",
        "modules": ["exams", "cbc", "igcse", "discipline", "events", "messaging", "hr", "analytics"],
        "price_kes": 0,
        "grace_days": 14,
        "sort_order": 3,
    },
]


def upgrade() -> None:
    op.create_table(
        "subscription_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("modules", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("price_kes", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("billing_cycle", sa.String(length=16), nullable=False, server_default=sa.text("'per_term'")),
        sa.Column("grace_days", sa.Integer(), nullable=False, server_default=sa.text("14")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        schema="core",
    )

    conn = op.get_bind()
    for plan in _SEED_PLANS:
        conn.execute(
            sa.text(
                "INSERT INTO core.subscription_plans "
                "(code, name, modules, price_kes, grace_days, sort_order) "
                "VALUES (:code, :name, CAST(:modules AS jsonb), :price, :grace, :sort) "
                "ON CONFLICT (code) DO NOTHING"
            ),
            {
                "code": plan["code"],
                "name": plan["name"],
                "modules": json.dumps(plan["modules"]),
                "price": plan["price_kes"],
                "grace": plan["grace_days"],
                "sort": plan["sort_order"],
            },
        )


def downgrade() -> None:
    op.drop_table("subscription_plans", schema="core")
