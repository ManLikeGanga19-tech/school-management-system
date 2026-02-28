"""add staff separation columns for fired/left lifecycle

Revision ID: o1p2q3r4s5u6
Revises: n0p1q2r3s4t5
Create Date: 2026-02-28 18:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "o1p2q3r4s5u6"
down_revision: Union[str, None] = "n0p1q2r3s4t5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "staff_directory",
        sa.Column("separation_status", sa.String(length=32), nullable=True),
        schema="core",
    )
    op.add_column(
        "staff_directory",
        sa.Column("separation_reason", sa.String(length=1000), nullable=True),
        schema="core",
    )
    op.add_column(
        "staff_directory",
        sa.Column("separation_date", sa.Date(), nullable=True),
        schema="core",
    )
    op.create_check_constraint(
        "ck_staff_directory_separation_status",
        "staff_directory",
        "separation_status IS NULL OR separation_status IN ('FIRED_MISCONDUCT', 'LEFT_PERMANENTLY')",
        schema="core",
    )
    op.create_index(
        "ix_staff_directory_tenant_separation_status",
        "staff_directory",
        ["tenant_id", "separation_status"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_staff_directory_tenant_separation_status",
        table_name="staff_directory",
        schema="core",
    )
    op.drop_constraint(
        "ck_staff_directory_separation_status",
        "staff_directory",
        schema="core",
        type_="check",
    )
    op.drop_column("staff_directory", "separation_date", schema="core")
    op.drop_column("staff_directory", "separation_reason", schema="core")
    op.drop_column("staff_directory", "separation_status", schema="core")
