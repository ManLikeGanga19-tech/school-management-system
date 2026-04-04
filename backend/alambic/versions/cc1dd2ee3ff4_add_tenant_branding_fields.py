"""add tenant branding fields (brand_color, school_address, school_phone, school_email)

Revision ID: cc1dd2ee3ff4
Revises: bb1cc2dd3ee4, m3n4o5p6q7r8, l5m6n7o8p9q0
Create Date: 2026-04-03 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "cc1dd2ee3ff4"
down_revision: Union[str, tuple] = ("bb1cc2dd3ee4", "m3n4o5p6q7r8", "l5m6n7o8p9q0")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("brand_color", sa.String(7), nullable=True),
        schema="core",
    )
    op.add_column(
        "tenants",
        sa.Column("school_address", sa.String(300), nullable=True),
        schema="core",
    )
    op.add_column(
        "tenants",
        sa.Column("school_phone", sa.String(60), nullable=True),
        schema="core",
    )
    op.add_column(
        "tenants",
        sa.Column("school_email", sa.String(200), nullable=True),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("tenants", "school_email", schema="core")
    op.drop_column("tenants", "school_phone", schema="core")
    op.drop_column("tenants", "school_address", schema="core")
    op.drop_column("tenants", "brand_color", schema="core")
