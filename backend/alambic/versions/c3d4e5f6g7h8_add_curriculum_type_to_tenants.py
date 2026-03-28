"""add curriculum_type to tenants

Revision ID: c3d4e5f6g7h8
Revises: b2c3d4e5f6g7
Create Date: 2026-03-27 08:00:00.000000

Adds curriculum_type to core.tenants so academic logic (grading, reports,
CBC vs 8-4-4) can branch per school.

Allowed values: CBC, 8-4-4, IGCSE
Default: CBC  (matches the current Kenyan curriculum mandate)
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6g7h8"
down_revision: Union[str, None] = "b2c3d4e5f6g7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VALID_VALUES = ("CBC", "8-4-4", "IGCSE")


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "curriculum_type",
            sa.String(20),
            nullable=False,
            server_default="CBC",
        ),
        schema="core",
    )
    op.create_check_constraint(
        "ck_tenants_curriculum_type",
        "tenants",
        "curriculum_type IN ('CBC', '8-4-4', 'IGCSE')",
        schema="core",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_tenants_curriculum_type",
        "tenants",
        schema="core",
        type_="check",
    )
    op.drop_column("tenants", "curriculum_type", schema="core")
