"""add state_override to subscriptions and tenant_groups

A nullable manual override for the subscription lifecycle state. When
set (active / grace / locked) it wins over the date-computed state;
when null the state is computed from the expiry date as before.

Revision ID: h2s3t4o5v6r7
Revises: g1r2o3u4p5s6
Create Date: 2026-05-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "h2s3t4o5v6r7"
down_revision = "g1r2o3u4p5s6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("subscriptions", "tenant_groups"):
        op.add_column(
            table,
            sa.Column("state_override", sa.String(length=16), nullable=True),
            schema="core",
        )


def downgrade() -> None:
    for table in ("subscriptions", "tenant_groups"):
        op.drop_column(table, "state_override", schema="core")
