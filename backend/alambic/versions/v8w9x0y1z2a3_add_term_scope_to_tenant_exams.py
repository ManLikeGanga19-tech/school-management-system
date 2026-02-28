"""add term scope to tenant exams

Revision ID: v8w9x0y1z2a3
Revises: u7v8w9x0y1z2
Create Date: 2026-02-28 16:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "v8w9x0y1z2a3"
down_revision: Union[str, None] = "u7v8w9x0y1z2"
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


def _index_names(schema_name: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    try:
        return {idx["name"] for idx in inspector.get_indexes(table_name, schema=schema_name)}
    except Exception:
        return set()


def _foreign_key_names(schema_name: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    try:
        return {fk["name"] for fk in inspector.get_foreign_keys(table_name, schema=schema_name) if fk.get("name")}
    except Exception:
        return set()


def upgrade() -> None:
    schema = "core"
    table = "tenant_exams"
    if not _table_exists(schema, table):
        return

    cols = _column_names(schema, table)
    if "term_id" not in cols:
        op.add_column(
            table,
            sa.Column("term_id", postgresql.UUID(as_uuid=True), nullable=True),
            schema=schema,
        )

    fk_name = "fk_tenant_exams_term_id_tenant_terms"
    if fk_name not in _foreign_key_names(schema, table):
        op.create_foreign_key(
            fk_name,
            source_table=table,
            referent_table="tenant_terms",
            local_cols=["term_id"],
            remote_cols=["id"],
            source_schema=schema,
            referent_schema=schema,
            ondelete="SET NULL",
        )

    idx_name = "ix_tenant_exams_tenant_term_date"
    if idx_name not in _index_names(schema, table):
        op.create_index(
            idx_name,
            table,
            ["tenant_id", "term_id", "start_date"],
            unique=False,
            schema=schema,
        )

    # Backfill from tenant terms to avoid leaving existing rows unscoped where possible.
    op.execute(
        """
        UPDATE core.tenant_exams e
        SET term_id = (
            SELECT tt.id
            FROM core.tenant_terms tt
            WHERE tt.tenant_id = e.tenant_id
            ORDER BY COALESCE(tt.is_active, true) DESC,
                     tt.start_date ASC NULLS LAST,
                     tt.name ASC
            LIMIT 1
        )
        WHERE e.term_id IS NULL
        """
    )


def downgrade() -> None:
    schema = "core"
    table = "tenant_exams"
    if not _table_exists(schema, table):
        return

    idx_name = "ix_tenant_exams_tenant_term_date"
    if idx_name in _index_names(schema, table):
        op.drop_index(idx_name, table_name=table, schema=schema)

    fk_name = "fk_tenant_exams_term_id_tenant_terms"
    if fk_name in _foreign_key_names(schema, table):
        op.drop_constraint(fk_name, table_name=table, schema=schema, type_="foreignkey")

    if "term_id" in _column_names(schema, table):
        op.drop_column(table, "term_id", schema=schema)
