"""add tenant events module tables

Revision ID: x1y2z3a4b5c6
Revises: w9x0y1z2a3b
Create Date: 2026-03-01 10:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "x1y2z3a4b5c6"
down_revision: Union[str, None] = "w9x0y1z2a3b"
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

    if not _table_exists(schema, "tenant_events"):
        op.create_table(
            "tenant_events",
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
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column(
                "term_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_terms.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("academic_year", sa.Integer(), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("start_time", sa.Time(), nullable=True),
            sa.Column("end_time", sa.Time(), nullable=True),
            sa.Column("location", sa.String(length=200), nullable=True),
            sa.Column("description", sa.String(length=2000), nullable=True),
            sa.Column(
                "target_scope",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'ALL'"),
            ),
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
            sa.CheckConstraint("start_date <= end_date", name="ck_tenant_events_valid_date_range"),
            sa.CheckConstraint(
                "target_scope IN ('ALL','CLASS','STUDENT','MIXED')",
                name="ck_tenant_events_target_scope",
            ),
            schema=schema,
        )

    event_indexes = _index_names(schema, "tenant_events")
    if "ix_tenant_events_tenant_term_date" not in event_indexes:
        op.create_index(
            "ix_tenant_events_tenant_term_date",
            "tenant_events",
            ["tenant_id", "term_id", "start_date"],
            unique=False,
            schema=schema,
        )
    if "ix_tenant_events_tenant_year_date" not in event_indexes:
        op.create_index(
            "ix_tenant_events_tenant_year_date",
            "tenant_events",
            ["tenant_id", "academic_year", "start_date"],
            unique=False,
            schema=schema,
        )
    if "ix_tenant_events_tenant_scope_active" not in event_indexes:
        op.create_index(
            "ix_tenant_events_tenant_scope_active",
            "tenant_events",
            ["tenant_id", "target_scope", "is_active"],
            unique=False,
            schema=schema,
        )

    if not _table_exists(schema, "tenant_event_classes"):
        op.create_table(
            "tenant_event_classes",
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
                "event_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_events.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("class_code", sa.String(length=80), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.UniqueConstraint(
                "tenant_id",
                "event_id",
                "class_code",
                name="uq_tenant_event_classes_tenant_event_class",
            ),
            schema=schema,
        )

    class_indexes = _index_names(schema, "tenant_event_classes")
    if "ix_tenant_event_classes_tenant_event" not in class_indexes:
        op.create_index(
            "ix_tenant_event_classes_tenant_event",
            "tenant_event_classes",
            ["tenant_id", "event_id"],
            unique=False,
            schema=schema,
        )
    if "ix_tenant_event_classes_tenant_class" not in class_indexes:
        op.create_index(
            "ix_tenant_event_classes_tenant_class",
            "tenant_event_classes",
            ["tenant_id", "class_code"],
            unique=False,
            schema=schema,
        )

    if not _table_exists(schema, "tenant_event_students"):
        op.create_table(
            "tenant_event_students",
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
                "event_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_events.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "student_enrollment_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.enrollments.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.UniqueConstraint(
                "tenant_id",
                "event_id",
                "student_enrollment_id",
                name="uq_tenant_event_students_tenant_event_student",
            ),
            schema=schema,
        )

    student_indexes = _index_names(schema, "tenant_event_students")
    if "ix_tenant_event_students_tenant_event" not in student_indexes:
        op.create_index(
            "ix_tenant_event_students_tenant_event",
            "tenant_event_students",
            ["tenant_id", "event_id"],
            unique=False,
            schema=schema,
        )
    if "ix_tenant_event_students_tenant_student" not in student_indexes:
        op.create_index(
            "ix_tenant_event_students_tenant_student",
            "tenant_event_students",
            ["tenant_id", "student_enrollment_id"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    schema = "core"

    if _table_exists(schema, "tenant_event_students"):
        student_indexes = _index_names(schema, "tenant_event_students")
        if "ix_tenant_event_students_tenant_student" in student_indexes:
            op.drop_index(
                "ix_tenant_event_students_tenant_student",
                table_name="tenant_event_students",
                schema=schema,
            )
        if "ix_tenant_event_students_tenant_event" in student_indexes:
            op.drop_index(
                "ix_tenant_event_students_tenant_event",
                table_name="tenant_event_students",
                schema=schema,
            )
        op.drop_table("tenant_event_students", schema=schema)

    if _table_exists(schema, "tenant_event_classes"):
        class_indexes = _index_names(schema, "tenant_event_classes")
        if "ix_tenant_event_classes_tenant_class" in class_indexes:
            op.drop_index(
                "ix_tenant_event_classes_tenant_class",
                table_name="tenant_event_classes",
                schema=schema,
            )
        if "ix_tenant_event_classes_tenant_event" in class_indexes:
            op.drop_index(
                "ix_tenant_event_classes_tenant_event",
                table_name="tenant_event_classes",
                schema=schema,
            )
        op.drop_table("tenant_event_classes", schema=schema)

    if _table_exists(schema, "tenant_events"):
        event_indexes = _index_names(schema, "tenant_events")
        if "ix_tenant_events_tenant_scope_active" in event_indexes:
            op.drop_index(
                "ix_tenant_events_tenant_scope_active",
                table_name="tenant_events",
                schema=schema,
            )
        if "ix_tenant_events_tenant_year_date" in event_indexes:
            op.drop_index(
                "ix_tenant_events_tenant_year_date",
                table_name="tenant_events",
                schema=schema,
            )
        if "ix_tenant_events_tenant_term_date" in event_indexes:
            op.drop_index(
                "ix_tenant_events_tenant_term_date",
                table_name="tenant_events",
                schema=schema,
            )
        op.drop_table("tenant_events", schema=schema)
