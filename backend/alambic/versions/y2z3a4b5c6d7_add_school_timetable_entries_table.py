"""add school timetable entries table

Revision ID: y2z3a4b5c6d7
Revises: x1y2z3a4b5c6
Create Date: 2026-03-01 13:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "y2z3a4b5c6d7"
down_revision: Union[str, None] = "x1y2z3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(schema_name: str, table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return bool(inspector.has_table(table_name, schema=schema_name))


def _index_names(schema_name: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    try:
        return {idx["name"] for idx in inspector.get_indexes(table_name, schema=schema_name)}
    except Exception:
        return set()


def upgrade() -> None:
    schema = "core"
    table_name = "school_timetable_entries"

    if not _table_exists(schema, table_name):
        op.create_table(
            table_name,
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                primary_key=True,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column(
                "tenant_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "term_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_terms.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("class_code", sa.String(length=80), nullable=False),
            sa.Column("day_of_week", sa.String(length=16), nullable=False),
            sa.Column(
                "slot_type",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'LESSON'"),
            ),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column(
                "subject_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_subjects.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "staff_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.staff_directory.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("start_time", sa.Time(), nullable=False),
            sa.Column("end_time", sa.Time(), nullable=False),
            sa.Column("location", sa.String(length=200), nullable=True),
            sa.Column("notes", sa.String(length=1000), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.CheckConstraint("start_time < end_time", name="ck_school_timetable_time_window"),
            sa.CheckConstraint(
                "day_of_week IN ('MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY')",
                name="ck_school_timetable_day_of_week",
            ),
            sa.CheckConstraint(
                "slot_type IN ('LESSON','SHORT_BREAK','LONG_BREAK','LUNCH_BREAK','GAME_TIME','OTHER')",
                name="ck_school_timetable_slot_type",
            ),
            sa.UniqueConstraint(
                "tenant_id",
                "term_id",
                "class_code",
                "day_of_week",
                "start_time",
                name="uq_school_timetable_entry_slot",
            ),
            schema=schema,
        )

    idx_names = _index_names(schema, table_name)
    if "ix_school_timetable_entries_tenant_term_class_day_time" not in idx_names:
        op.create_index(
            "ix_school_timetable_entries_tenant_term_class_day_time",
            table_name,
            ["tenant_id", "term_id", "class_code", "day_of_week", "start_time"],
            unique=False,
            schema=schema,
        )
    if "ix_school_timetable_entries_tenant_day_time" not in idx_names:
        op.create_index(
            "ix_school_timetable_entries_tenant_day_time",
            table_name,
            ["tenant_id", "day_of_week", "start_time"],
            unique=False,
            schema=schema,
        )
    if "ix_school_timetable_entries_tenant_active" not in idx_names:
        op.create_index(
            "ix_school_timetable_entries_tenant_active",
            table_name,
            ["tenant_id", "is_active"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    schema = "core"
    table_name = "school_timetable_entries"
    if not _table_exists(schema, table_name):
        return

    idx_names = _index_names(schema, table_name)
    if "ix_school_timetable_entries_tenant_active" in idx_names:
        op.drop_index(
            "ix_school_timetable_entries_tenant_active",
            table_name=table_name,
            schema=schema,
        )
    if "ix_school_timetable_entries_tenant_day_time" in idx_names:
        op.drop_index(
            "ix_school_timetable_entries_tenant_day_time",
            table_name=table_name,
            schema=schema,
        )
    if "ix_school_timetable_entries_tenant_term_class_day_time" in idx_names:
        op.drop_index(
            "ix_school_timetable_entries_tenant_term_class_day_time",
            table_name=table_name,
            schema=schema,
        )

    op.drop_table(table_name, schema=schema)
