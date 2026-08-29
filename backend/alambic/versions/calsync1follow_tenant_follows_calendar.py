"""add core.tenants.follows_platform_calendar

Drives auto-sync of the SaaS platform academic calendar into a tenant's own
terms. When true (the default), saving the SaaS academic calendar auto-applies
(overwrite) its term dates to the tenant, so term turnover stays aligned without
a manual push. A tenant flips to false the moment it edits its own term dates,
so schools that self-manage keep their calendar. Defaults true — existing
tenants follow the platform calendar, matching prior applied behaviour.

Revision ID: calsync1follow
Revises: demo1a2b3c4d
"""
from alembic import op
import sqlalchemy as sa

revision = "calsync1follow"
down_revision = "demo1a2b3c4d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "follows_platform_calendar",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("tenants", "follows_platform_calendar", schema="core")
