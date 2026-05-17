"""align subscription plans with the marketing site

Replaces the placeholder Basic/Standard/Premium seed with the tiers the
marketing site actually sells — Starter / Growth / Enterprise — with the
matching per-term pricing and module unlocks. Safe because no tenant is
assigned a tier yet (plan_code is freshly introduced).

Module mapping (per the marketing pricing page):
  - Growth-and-up only: discipline, hr, analytics
  - All tiers: cbc, exams, igcse, events, messaging

Revision ID: u3p4l5a6n6s7
Revises: t2i3e4r5c6d7
Create Date: 2026-05-17 00:00:00.000000

"""
import json

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "u3p4l5a6n6s7"
down_revision = "t2i3e4r5c6d7"
branch_labels = None
depends_on = None


_ALL_GATEABLE = ["cbc", "exams", "igcse", "events", "messaging", "discipline", "hr", "analytics"]
_STARTER = ["cbc", "exams", "igcse", "events", "messaging"]

_PLANS = [
    {"code": "starter", "name": "Starter", "modules": _STARTER, "price": 8000, "sort": 1},
    {"code": "growth", "name": "Growth", "modules": _ALL_GATEABLE, "price": 16000, "sort": 2},
    # Enterprise is custom-priced (0 = "contact sales"); same modules as Growth.
    {"code": "enterprise", "name": "Enterprise", "modules": _ALL_GATEABLE, "price": 0, "sort": 3},
]


def upgrade() -> None:
    conn = op.get_bind()

    # Drop the placeholder seed tiers (only if unused — none are assigned yet).
    conn.execute(
        sa.text(
            "DELETE FROM core.subscription_plans "
            "WHERE code IN ('basic', 'standard', 'premium') "
            "AND code NOT IN (SELECT DISTINCT plan_code FROM core.subscriptions "
            "                 WHERE plan_code IS NOT NULL)"
        )
    )

    for p in _PLANS:
        conn.execute(
            sa.text(
                "INSERT INTO core.subscription_plans "
                "(code, name, modules, price_kes, billing_cycle, grace_days, sort_order) "
                "VALUES (:code, :name, CAST(:modules AS jsonb), :price, 'per_term', 14, :sort) "
                "ON CONFLICT (code) DO UPDATE SET "
                "name = EXCLUDED.name, modules = EXCLUDED.modules, "
                "price_kes = EXCLUDED.price_kes, sort_order = EXCLUDED.sort_order, "
                "updated_at = now()"
            ),
            {
                "code": p["code"],
                "name": p["name"],
                "modules": json.dumps(p["modules"]),
                "price": p["price"],
                "sort": p["sort"],
            },
        )


def downgrade() -> None:
    # Non-reversible data alignment — no-op.
    pass
