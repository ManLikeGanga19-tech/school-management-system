"""add receipt print profile fields (po_box, address, phone, email, motto, signatory)

Revision ID: a1b2c3d4e5f6
Revises: z3a4b5c6d7e8
Create Date: 2026-03-24 08:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "j2k3l4m5n6o7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_cols = {col["name"] for col in insp.get_columns("tenant_print_profiles", schema="core")}

    new_cols = [
        ("po_box", sa.String(100)),
        ("physical_address", sa.Text()),
        ("phone", sa.String(50)),
        ("email", sa.String(255)),
        ("school_motto", sa.String(500)),
        ("authorized_signatory_name", sa.String(200)),
        ("authorized_signatory_title", sa.String(200)),
    ]

    for col_name, col_type in new_cols:
        if col_name not in existing_cols:
            op.add_column(
                "tenant_print_profiles",
                sa.Column(col_name, col_type, nullable=True),
                schema="core",
            )


def downgrade() -> None:
    for col_name in [
        "authorized_signatory_title",
        "authorized_signatory_name",
        "school_motto",
        "email",
        "phone",
        "physical_address",
        "po_box",
    ]:
        op.drop_column("tenant_print_profiles", col_name, schema="core")
