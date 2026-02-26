"""harden subscriptions defaults and not-null

Revision ID: f336775c23cd
Revises: 669928d6b499
Create Date: 2026-02-23 16:35:29.602302

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f336775c23cd'
down_revision: Union[str, None] = '669928d6b499'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # backfill in case any nulls exist
    op.execute("UPDATE core.subscriptions SET created_at = now() WHERE created_at IS NULL")
    op.execute("UPDATE core.subscriptions SET discount_percent = 0.0 WHERE discount_percent IS NULL")

    op.alter_column(
        "subscriptions",
        "created_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
        schema="core",
    )
    op.alter_column(
        "subscriptions",
        "discount_percent",
        existing_type=sa.Numeric(5, 2),
        nullable=False,
        server_default=sa.text("0.0"),
        schema="core",
    )


def downgrade() -> None:
    op.alter_column("subscriptions", "created_at", nullable=True, schema="core")
    op.alter_column("subscriptions", "discount_percent", nullable=True, schema="core")