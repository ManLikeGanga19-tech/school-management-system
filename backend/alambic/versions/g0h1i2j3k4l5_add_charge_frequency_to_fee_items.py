"""add charge_frequency enum to fee_items

Revision ID: g0h1i2j3k4l5
Revises: f9g0h1i2j3k4
Create Date: 2026-03-30 08:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "g0h1i2j3k4l5"
down_revision: Union[str, None] = "f9g0h1i2j3k4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the enum type first
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE core.charge_frequency AS ENUM (
                'PER_TERM',
                'ONCE_PER_YEAR',
                'ONCE_EVER'
            );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    # Add column with default, then set NOT NULL
    op.add_column(
        "fee_items",
        sa.Column(
            "charge_frequency",
            sa.Enum("PER_TERM", "ONCE_PER_YEAR", "ONCE_EVER",
                    name="charge_frequency", schema="core"),
            nullable=True,
            server_default="PER_TERM",
        ),
        schema="core",
    )

    # Backfill existing rows
    op.execute("UPDATE core.fee_items SET charge_frequency = 'PER_TERM' WHERE charge_frequency IS NULL")

    # Make it NOT NULL
    op.alter_column("fee_items", "charge_frequency", nullable=False, schema="core")


def downgrade() -> None:
    op.drop_column("fee_items", "charge_frequency", schema="core")
    op.execute("""
        DO $$ BEGIN
            DROP TYPE core.charge_frequency;
        EXCEPTION WHEN undefined_object THEN NULL;
        END $$;
    """)
