"""Add scholarship max_recipients, description; add student_id to scholarship_allocations

Revision ID: dd1ee2ff3gg4
Revises: cc1dd2ee3ff4
Create Date: 2026-04-04 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "dd1ee2ff3gg4"
down_revision: Union[str, tuple] = "cc1dd2ee3ff4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # scholarship: add max_recipients (pool split) and description
    op.add_column(
        "scholarships",
        sa.Column("max_recipients", sa.Integer(), nullable=True),
        schema="core",
    )
    op.add_column(
        "scholarships",
        sa.Column("description", sa.String(500), nullable=True),
        schema="core",
    )

    # scholarship_allocations: add student_id for fast per-scholarship student listing
    op.add_column(
        "scholarship_allocations",
        sa.Column("student_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        schema="core",
    )
    # Make reason nullable (previously NOT NULL) for backwards compat
    op.alter_column(
        "scholarship_allocations",
        "reason",
        existing_type=sa.String(500),
        nullable=True,
        schema="core",
    )


def downgrade() -> None:
    op.alter_column(
        "scholarship_allocations",
        "reason",
        existing_type=sa.String(500),
        nullable=False,
        schema="core",
    )
    op.drop_column("scholarship_allocations", "student_id", schema="core")
    op.drop_column("scholarships", "description", schema="core")
    op.drop_column("scholarships", "max_recipients", schema="core")
