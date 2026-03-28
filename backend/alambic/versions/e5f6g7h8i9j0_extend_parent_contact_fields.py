"""extend parent contact fields

Revision ID: e5f6g7h8i9j0
Revises: d4e5f6g7h8i9
Create Date: 2026-03-27 08:20:00.000000

Adds first_name, last_name, phone, phone_alt, email, id_type, address
to core.parents so guardian contact info lives on the parent record
rather than only on core.users.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6g7h8i9j0"
down_revision: Union[str, None] = "d4e5f6g7h8i9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_COLS = [
    ("first_name", sa.String(120)),
    ("last_name",  sa.String(120)),
    ("phone",      sa.String(50)),
    ("phone_alt",  sa.String(50)),
    ("email",      sa.String(200)),
    ("id_type",    sa.String(30)),   # NATIONAL_ID, PASSPORT, OTHER
    ("address",    sa.Text()),
]


def upgrade() -> None:
    for col_name, col_type in _NEW_COLS:
        op.add_column(
            "parents",
            sa.Column(col_name, col_type, nullable=True),
            schema="core",
        )


def downgrade() -> None:
    for col_name, _ in reversed(_NEW_COLS):
        op.drop_column("parents", col_name, schema="core")
