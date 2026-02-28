"""add role_code column to staff_directory

Revision ID: p2q3r4s5u6v7
Revises: o1p2q3r4s5u6
Create Date: 2026-02-28 20:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "p2q3r4s5u6v7"
down_revision: Union[str, None] = "o1p2q3r4s5u6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _staff_columns(bind) -> set[str]:
    inspector = sa.inspect(bind)
    try:
        cols = inspector.get_columns("staff_directory", schema="core")
    except Exception:
        return set()
    return {str(col.get("name")) for col in cols if col.get("name")}


def _staff_indexes(bind) -> set[str]:
    inspector = sa.inspect(bind)
    try:
        indexes = inspector.get_indexes("staff_directory", schema="core")
    except Exception:
        return set()
    return {str(idx.get("name")) for idx in indexes if idx.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _staff_columns(bind)
    if "role_code" not in cols:
        op.add_column(
            "staff_directory",
            sa.Column("role_code", sa.String(length=60), nullable=True),
            schema="core",
        )

    idxs = _staff_indexes(bind)
    if "ix_staff_directory_tenant_role_code" not in idxs:
        op.create_index(
            "ix_staff_directory_tenant_role_code",
            "staff_directory",
            ["tenant_id", "role_code"],
            unique=False,
            schema="core",
        )


def downgrade() -> None:
    bind = op.get_bind()
    idxs = _staff_indexes(bind)
    if "ix_staff_directory_tenant_role_code" in idxs:
        op.drop_index(
            "ix_staff_directory_tenant_role_code",
            table_name="staff_directory",
            schema="core",
        )

    cols = _staff_columns(bind)
    if "role_code" in cols:
        op.drop_column("staff_directory", "role_code", schema="core")
