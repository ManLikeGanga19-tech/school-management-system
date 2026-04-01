"""upgrade fee_structure_items: per-term amount columns

Revision ID: i2j3k4l5m6n7
Revises: h1i2j3k4l5m6
Create Date: 2026-03-30 08:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "i2j3k4l5m6n7"
down_revision: Union[str, None] = "h1i2j3k4l5m6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add three per-term amount columns (nullable initially for backfill)
    op.add_column(
        "fee_structure_items",
        sa.Column("term_1_amount", sa.Numeric(12, 2), nullable=True),
        schema="core",
    )
    op.add_column(
        "fee_structure_items",
        sa.Column("term_2_amount", sa.Numeric(12, 2), nullable=True),
        schema="core",
    )
    op.add_column(
        "fee_structure_items",
        sa.Column("term_3_amount", sa.Numeric(12, 2), nullable=True),
        schema="core",
    )

    # Backfill: copy existing `amount` to all three terms
    op.execute("""
        UPDATE core.fee_structure_items
        SET
            term_1_amount = amount,
            term_2_amount = amount,
            term_3_amount = amount
        WHERE term_1_amount IS NULL
    """)

    # Make NOT NULL
    op.alter_column("fee_structure_items", "term_1_amount", nullable=False, schema="core")
    op.alter_column("fee_structure_items", "term_2_amount", nullable=False, schema="core")
    op.alter_column("fee_structure_items", "term_3_amount", nullable=False, schema="core")

    # Keep `amount` column for backwards compat with existing PDF/service code —
    # it will be deprecated and removed once the new service is live.


def downgrade() -> None:
    op.drop_column("fee_structure_items", "term_3_amount", schema="core")
    op.drop_column("fee_structure_items", "term_2_amount", schema="core")
    op.drop_column("fee_structure_items", "term_1_amount", schema="core")
