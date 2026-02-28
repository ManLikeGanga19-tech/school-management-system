"""add tenant exams and exam marks tables

Revision ID: u7v8w9x0y1z2
Revises: t6u7v8w9x0y1
Create Date: 2026-02-28 12:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "u7v8w9x0y1z2"
down_revision: Union[str, None] = "t6u7v8w9x0y1"
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

    if not _table_exists(schema, "tenant_exams"):
        op.create_table(
            "tenant_exams",
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
            sa.Column("class_code", sa.String(length=80), nullable=False),
            sa.Column(
                "subject_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_subjects.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "invigilator_staff_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.staff_directory.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("start_time", sa.Time(), nullable=True),
            sa.Column(
                "status",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'SCHEDULED'"),
            ),
            sa.Column("location", sa.String(length=160), nullable=True),
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
            sa.CheckConstraint("start_date <= end_date", name="ck_tenant_exams_valid_date_range"),
            schema=schema,
        )

    exam_indexes = _index_names(schema, "tenant_exams")
    if "ix_tenant_exams_tenant_class_date" not in exam_indexes:
        op.create_index(
            "ix_tenant_exams_tenant_class_date",
            "tenant_exams",
            ["tenant_id", "class_code", "start_date"],
            unique=False,
            schema=schema,
        )
    if "ix_tenant_exams_tenant_status_date" not in exam_indexes:
        op.create_index(
            "ix_tenant_exams_tenant_status_date",
            "tenant_exams",
            ["tenant_id", "status", "start_date"],
            unique=False,
            schema=schema,
        )
    if "ix_tenant_exams_tenant_invigilator" not in exam_indexes:
        op.create_index(
            "ix_tenant_exams_tenant_invigilator",
            "tenant_exams",
            ["tenant_id", "invigilator_staff_id"],
            unique=False,
            schema=schema,
        )

    if not _table_exists(schema, "tenant_exam_marks"):
        op.create_table(
            "tenant_exam_marks",
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
                "exam_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_exams.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "student_enrollment_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.enrollments.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "subject_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_subjects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("class_code", sa.String(length=80), nullable=False),
            sa.Column("marks_obtained", sa.Numeric(7, 2), nullable=False, server_default=sa.text("0")),
            sa.Column("max_marks", sa.Numeric(7, 2), nullable=False, server_default=sa.text("100")),
            sa.Column("grade", sa.String(length=16), nullable=True),
            sa.Column("remarks", sa.String(length=500), nullable=True),
            sa.Column(
                "recorded_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "recorded_at",
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
            sa.UniqueConstraint(
                "tenant_id",
                "exam_id",
                "student_enrollment_id",
                "subject_id",
                name="uq_tenant_exam_marks_exam_student_subject",
            ),
            sa.CheckConstraint("marks_obtained >= 0", name="ck_tenant_exam_marks_non_negative"),
            sa.CheckConstraint("max_marks > 0", name="ck_tenant_exam_marks_positive_max"),
            schema=schema,
        )

    mark_indexes = _index_names(schema, "tenant_exam_marks")
    if "ix_tenant_exam_marks_tenant_exam" not in mark_indexes:
        op.create_index(
            "ix_tenant_exam_marks_tenant_exam",
            "tenant_exam_marks",
            ["tenant_id", "exam_id"],
            unique=False,
            schema=schema,
        )
    if "ix_tenant_exam_marks_tenant_class_subject" not in mark_indexes:
        op.create_index(
            "ix_tenant_exam_marks_tenant_class_subject",
            "tenant_exam_marks",
            ["tenant_id", "class_code", "subject_id"],
            unique=False,
            schema=schema,
        )
    if "ix_tenant_exam_marks_tenant_student" not in mark_indexes:
        op.create_index(
            "ix_tenant_exam_marks_tenant_student",
            "tenant_exam_marks",
            ["tenant_id", "student_enrollment_id"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    schema = "core"

    if _table_exists(schema, "tenant_exam_marks"):
        mark_indexes = _index_names(schema, "tenant_exam_marks")
        if "ix_tenant_exam_marks_tenant_student" in mark_indexes:
            op.drop_index(
                "ix_tenant_exam_marks_tenant_student",
                table_name="tenant_exam_marks",
                schema=schema,
            )
        if "ix_tenant_exam_marks_tenant_class_subject" in mark_indexes:
            op.drop_index(
                "ix_tenant_exam_marks_tenant_class_subject",
                table_name="tenant_exam_marks",
                schema=schema,
            )
        if "ix_tenant_exam_marks_tenant_exam" in mark_indexes:
            op.drop_index(
                "ix_tenant_exam_marks_tenant_exam",
                table_name="tenant_exam_marks",
                schema=schema,
            )
        op.drop_table("tenant_exam_marks", schema=schema)

    if _table_exists(schema, "tenant_exams"):
        exam_indexes = _index_names(schema, "tenant_exams")
        if "ix_tenant_exams_tenant_invigilator" in exam_indexes:
            op.drop_index(
                "ix_tenant_exams_tenant_invigilator",
                table_name="tenant_exams",
                schema=schema,
            )
        if "ix_tenant_exams_tenant_status_date" in exam_indexes:
            op.drop_index(
                "ix_tenant_exams_tenant_status_date",
                table_name="tenant_exams",
                schema=schema,
            )
        if "ix_tenant_exams_tenant_class_date" in exam_indexes:
            op.drop_index(
                "ix_tenant_exams_tenant_class_date",
                table_name="tenant_exams",
                schema=schema,
            )
        op.drop_table("tenant_exams", schema=schema)
