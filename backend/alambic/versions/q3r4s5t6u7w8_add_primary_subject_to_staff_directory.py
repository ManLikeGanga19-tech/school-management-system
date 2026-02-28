"""add primary_subject_id to staff_directory

Revision ID: q3r4s5t6u7w8
Revises: p2q3r4s5u6v7
Create Date: 2026-02-28 23:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "q3r4s5t6u7w8"
down_revision: Union[str, None] = "p2q3r4s5u6v7"
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


def _staff_foreign_keys(bind) -> set[str]:
    inspector = sa.inspect(bind)
    try:
        foreign_keys = inspector.get_foreign_keys("staff_directory", schema="core")
    except Exception:
        return set()
    return {str(fk.get("name")) for fk in foreign_keys if fk.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _staff_columns(bind)
    if "primary_subject_id" not in cols:
        op.add_column(
            "staff_directory",
            sa.Column("primary_subject_id", postgresql.UUID(as_uuid=True), nullable=True),
            schema="core",
        )

    fks = _staff_foreign_keys(bind)
    if "fk_staff_directory_primary_subject_id" not in fks:
        op.create_foreign_key(
            "fk_staff_directory_primary_subject_id",
            source_table="staff_directory",
            referent_table="tenant_subjects",
            local_cols=["primary_subject_id"],
            remote_cols=["id"],
            source_schema="core",
            referent_schema="core",
            ondelete="SET NULL",
        )

    indexes = _staff_indexes(bind)
    if "ix_staff_directory_tenant_primary_subject" not in indexes:
        op.create_index(
            "ix_staff_directory_tenant_primary_subject",
            "staff_directory",
            ["tenant_id", "primary_subject_id"],
            unique=False,
            schema="core",
        )


def downgrade() -> None:
    bind = op.get_bind()
    indexes = _staff_indexes(bind)
    if "ix_staff_directory_tenant_primary_subject" in indexes:
        op.drop_index(
            "ix_staff_directory_tenant_primary_subject",
            table_name="staff_directory",
            schema="core",
        )

    fks = _staff_foreign_keys(bind)
    if "fk_staff_directory_primary_subject_id" in fks:
        op.drop_constraint(
            "fk_staff_directory_primary_subject_id",
            "staff_directory",
            schema="core",
            type_="foreignkey",
        )

    cols = _staff_columns(bind)
    if "primary_subject_id" in cols:
        op.drop_column("staff_directory", "primary_subject_id", schema="core")
