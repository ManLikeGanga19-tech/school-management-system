"""add core.tenants.is_demo (read-only public demo tenant)

A demo tenant carries published credentials on the marketing site, so it must
be provably unable to write. This flag drives a middleware guard that rejects
every mutating request for such a tenant. Defaults false — existing tenants are
unaffected.

Revision ID: demo1a2b3c4d
Revises: idx1tenant2a3b
"""
from alembic import op
import sqlalchemy as sa

revision = "demo1a2b3c4d"
down_revision = "idx1tenant2a3b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("tenants", "is_demo", schema="core")
