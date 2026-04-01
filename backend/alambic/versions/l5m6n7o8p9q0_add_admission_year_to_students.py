"""add admission_year to students

Revision ID: l5m6n7o8p9q0
Revises: k4l5m6n7o8p9
Create Date: 2026-03-30 08:25:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "l5m6n7o8p9q0"
down_revision: Union[str, None] = "k4l5m6n7o8p9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "students",
        sa.Column("admission_year", sa.SmallInteger(), nullable=True),
        schema="core",
    )

    # Backfill from created_at year for all existing students
    op.execute("""
        UPDATE core.students
        SET admission_year = EXTRACT(YEAR FROM created_at)::smallint
        WHERE admission_year IS NULL
    """)

    # Make NOT NULL — all rows are now populated
    op.alter_column("students", "admission_year", nullable=False, schema="core")


def downgrade() -> None:
    op.drop_column("students", "admission_year", schema="core")
