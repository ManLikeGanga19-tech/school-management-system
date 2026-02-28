"""add deleted_at to tenant notification reads

Revision ID: t6u7v8w9x0y1
Revises: s5t6u7v8w9x0
Create Date: 2026-03-01 00:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "t6u7v8w9x0y1"
down_revision: Union[str, None] = "s5t6u7v8w9x0"
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
    table = "tenant_notification_reads"
    cols = _column_names(schema, table)
    if "deleted_at" not in cols:
        op.add_column(
            table,
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            schema=schema,
        )

    indexes = _index_names(schema, table)
    if "ix_tenant_notification_reads_tenant_user_deleted_at" not in indexes:
        op.create_index(
            "ix_tenant_notification_reads_tenant_user_deleted_at",
            table,
            ["tenant_id", "user_id", "deleted_at"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    schema = "core"
    table = "tenant_notification_reads"
    indexes = _index_names(schema, table)
    if "ix_tenant_notification_reads_tenant_user_deleted_at" in indexes:
        op.drop_index(
            "ix_tenant_notification_reads_tenant_user_deleted_at",
            table_name=table,
            schema=schema,
        )

    cols = _column_names(schema, table)
    if "deleted_at" in cols:
        op.drop_column(table, "deleted_at", schema=schema)
