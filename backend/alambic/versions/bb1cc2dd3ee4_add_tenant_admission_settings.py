"""add tenant_admission_settings table

Revision ID: bb1cc2dd3ee4
Revises: aa1bb2cc3dd4
Create Date: 2026-04-03 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bb1cc2dd3ee4"
down_revision: Union[str, None] = "aa1bb2cc3dd4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_admission_settings",
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
            unique=True,
        ),
        sa.Column(
            "prefix",
            sa.String(30),
            nullable=False,
            server_default=sa.text("'ADM-'"),
        ),
        sa.Column(
            "last_number",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
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
    op.drop_table("tenant_admission_settings", schema="core")
