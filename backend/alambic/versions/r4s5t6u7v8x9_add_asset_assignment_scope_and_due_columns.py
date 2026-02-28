"""add assignee scope and due date columns to asset assignments

Revision ID: r4s5t6u7v8x9
Revises: q3r4s5t6u7w8
Create Date: 2026-02-28 23:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "r4s5t6u7v8x9"
down_revision: Union[str, None] = "q3r4s5t6u7w8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(schema_name: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {col["name"] for col in inspector.get_columns(table_name, schema=schema_name)}


def _index_names(schema_name: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {idx["name"] for idx in inspector.get_indexes(table_name, schema=schema_name)}


def upgrade() -> None:
    schema = "core"
    table = "asset_assignments"

    existing_columns = _column_names(schema, table)

    if "assignee_type" not in existing_columns:
        op.add_column(
            table,
            sa.Column(
                "assignee_type",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'STAFF'"),
            ),
            schema=schema,
        )

    if "class_code" not in existing_columns:
        op.add_column(
            table,
            sa.Column("class_code", sa.String(length=80), nullable=True),
            schema=schema,
        )

    if "enrollment_id" not in existing_columns:
        op.add_column(
            table,
            sa.Column(
                "enrollment_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.enrollments.id", ondelete="SET NULL"),
                nullable=True,
            ),
            schema=schema,
        )

    if "due_at" not in existing_columns:
        op.add_column(
            table,
            sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
            schema=schema,
        )

    if "staff_id" in existing_columns:
        op.alter_column(
            table,
            "staff_id",
            existing_type=postgresql.UUID(as_uuid=True),
            nullable=True,
            schema=schema,
        )

    existing_indexes = _index_names(schema, table)
    if "ix_asset_assignments_tenant_assignee_type" not in existing_indexes:
        op.create_index(
            "ix_asset_assignments_tenant_assignee_type",
            table,
            ["tenant_id", "assignee_type"],
            unique=False,
            schema=schema,
        )
    if "ix_asset_assignments_tenant_due_at" not in existing_indexes:
        op.create_index(
            "ix_asset_assignments_tenant_due_at",
            table,
            ["tenant_id", "due_at"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    schema = "core"
    table = "asset_assignments"

    existing_indexes = _index_names(schema, table)
    if "ix_asset_assignments_tenant_due_at" in existing_indexes:
        op.drop_index("ix_asset_assignments_tenant_due_at", table_name=table, schema=schema)
    if "ix_asset_assignments_tenant_assignee_type" in existing_indexes:
        op.drop_index("ix_asset_assignments_tenant_assignee_type", table_name=table, schema=schema)

    existing_columns = _column_names(schema, table)
    if "due_at" in existing_columns:
        op.drop_column(table, "due_at", schema=schema)
    if "enrollment_id" in existing_columns:
        op.drop_column(table, "enrollment_id", schema=schema)
    if "class_code" in existing_columns:
        op.drop_column(table, "class_code", schema=schema)
    if "assignee_type" in existing_columns:
        op.drop_column(table, "assignee_type", schema=schema)

