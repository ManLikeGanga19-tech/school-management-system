"""extend student biodata fields

Revision ID: d4e5f6g7h8i9
Revises: c3d4e5f6g7h8
Create Date: 2026-03-27 08:10:00.000000

Adds extended bio-data columns to core.students:
phone, email, nationality, religion, home_address, county, sub_county,
upi (NEMIS UPI), birth_certificate_no, previous_school, previous_class.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6g7h8i9"
down_revision: Union[str, None] = "c3d4e5f6g7h8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_COLS = [
    ("phone",               sa.String(50)),
    ("email",               sa.String(200)),
    ("nationality",         sa.String(80)),
    ("religion",            sa.String(80)),
    ("home_address",        sa.Text()),
    ("county",              sa.String(80)),
    ("sub_county",          sa.String(80)),
    ("upi",                 sa.String(100)),
    ("birth_certificate_no", sa.String(100)),
    ("previous_school",     sa.String(200)),
    ("previous_class",      sa.String(80)),
]


def upgrade() -> None:
    for col_name, col_type in _NEW_COLS:
        op.add_column(
            "students",
            sa.Column(col_name, col_type, nullable=True),
            schema="core",
        )

    # Index UPI for NEMIS lookups
    op.create_index(
        "ix_students_tenant_upi",
        "students",
        ["tenant_id", "upi"],
        schema="core",
        postgresql_where=sa.text("upi IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_students_tenant_upi", table_name="students", schema="core")
    for col_name, _ in reversed(_NEW_COLS):
        op.drop_column("students", col_name, schema="core")
