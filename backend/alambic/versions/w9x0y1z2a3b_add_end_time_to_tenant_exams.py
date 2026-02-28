"""add end_time to tenant exams

Revision ID: w9x0y1z2a3b
Revises: v8w9x0y1z2a3
Create Date: 2026-02-28 18:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "w9x0y1z2a3b"
down_revision: Union[str, None] = "v8w9x0y1z2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(schema_name: str, table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return bool(inspector.has_table(table_name, schema=schema_name))


def _column_names(schema_name: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    try:
        return {str(col["name"]) for col in inspector.get_columns(table_name, schema=schema_name)}
    except Exception:
        return set()


def upgrade() -> None:
    schema = "core"
    table = "tenant_exams"
    if not _table_exists(schema, table):
        return

    if "end_time" not in _column_names(schema, table):
        op.add_column(table, sa.Column("end_time", sa.Time(), nullable=True), schema=schema)

    op.execute(
        """
        UPDATE core.tenant_exams
        SET end_time = start_time
        WHERE end_time IS NULL AND start_time IS NOT NULL
        """
    )


def downgrade() -> None:
    schema = "core"
    table = "tenant_exams"
    if not _table_exists(schema, table):
        return

    if "end_time" in _column_names(schema, table):
        op.drop_column(table, "end_time", schema=schema)
