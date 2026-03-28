"""add attendance sessions and records tables

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-03-27 09:10:00.000000

Two tables power the attendance subsystem:

attendance_sessions
  A session is a single attendance-taking event for one class on one day.
  Session types:
    MORNING   — whole-day roll call (at most one per class/date)
    AFTERNOON — afternoon roll call (boarding schools)
    PERIOD    — single lesson/period (uses subject_id + period_number)

  State machine:  DRAFT → SUBMITTED → FINALIZED
    DRAFT      — teacher is actively recording; records may be added/changed.
    SUBMITTED  — teacher has completed marking; awaiting admin review.
    FINALIZED  — locked; changes require attendance.correct permission and
                 leave an audit trail on the record.

attendance_records
  One row per student per session.  The status can be corrected after
  finalization; when corrected the original value is preserved for audit.

  Status values: PRESENT / ABSENT / LATE / EXCUSED / OFF_GROUNDS
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "j0k1l2m3n4o5"
down_revision: Union[str, None] = "i9j0k1l2m3n4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(schema_name: str, table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return bool(inspector.has_table(table_name, schema=schema_name))


def upgrade() -> None:
    schema = "core"

    # ── attendance_sessions ──────────────────────────────────────────────────
    if not _table_exists(schema, "attendance_sessions"):
        op.create_table(
            "attendance_sessions",
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
                "class_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_classes.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "term_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_terms.id", ondelete="CASCADE"),
                nullable=False,
            ),
            # Nullable — only set for PERIOD-type sessions
            sa.Column("subject_id", postgresql.UUID(as_uuid=True)),
            sa.Column("session_date", sa.Date(), nullable=False),
            # MORNING / AFTERNOON / PERIOD
            sa.Column(
                "session_type",
                sa.String(30),
                nullable=False,
                server_default=sa.text("'MORNING'"),
            ),
            # Lesson number within the day (PERIOD sessions only)
            sa.Column("period_number", sa.SmallInteger()),
            # DRAFT / SUBMITTED / FINALIZED
            sa.Column(
                "status",
                sa.String(30),
                nullable=False,
                server_default=sa.text("'DRAFT'"),
            ),
            sa.Column("notes", sa.String(500)),
            sa.Column(
                "marked_by_user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.users.id", ondelete="SET NULL"),
            ),
            sa.Column("submitted_at", sa.DateTime(timezone=True)),
            sa.Column(
                "finalized_by_user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.users.id", ondelete="SET NULL"),
            ),
            sa.Column("finalized_at", sa.DateTime(timezone=True)),
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
            schema=schema,
        )

        # One MORNING/AFTERNOON session per class per day
        op.execute(
            """
            CREATE UNIQUE INDEX uq_attendance_sessions_daily
            ON core.attendance_sessions (tenant_id, class_id, session_date, session_type)
            WHERE session_type IN ('MORNING', 'AFTERNOON')
            """
        )
        # One PERIOD session per class / day / subject / period number
        op.execute(
            """
            CREATE UNIQUE INDEX uq_attendance_sessions_period
            ON core.attendance_sessions
                (tenant_id, class_id, session_date, session_type, subject_id, period_number)
            WHERE session_type = 'PERIOD'
            """
        )
        op.create_index(
            "ix_attendance_sessions_class_date",
            "attendance_sessions",
            ["tenant_id", "class_id", "session_date"],
            schema=schema,
        )
        op.create_index(
            "ix_attendance_sessions_term_status",
            "attendance_sessions",
            ["tenant_id", "term_id", "status"],
            schema=schema,
        )

    # ── attendance_records ────────────────────────────────────────────────────
    if not _table_exists(schema, "attendance_records"):
        op.create_table(
            "attendance_records",
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
                "session_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.attendance_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "enrollment_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.student_class_enrollments.id", ondelete="CASCADE"),
                nullable=False,
            ),
            # Denormalised for query performance — avoids a join to enrollments
            sa.Column(
                "student_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.students.id", ondelete="CASCADE"),
                nullable=False,
            ),
            # PRESENT / ABSENT / LATE / EXCUSED / OFF_GROUNDS
            sa.Column(
                "status",
                sa.String(30),
                nullable=False,
                server_default=sa.text("'PRESENT'"),
            ),
            sa.Column("notes", sa.String(500)),
            # ── Correction audit trail ────────────────────────────────────────
            # Populated only when a FINALIZED record is corrected.
            sa.Column("original_status", sa.String(30)),
            sa.Column("corrected_by_user_id", postgresql.UUID(as_uuid=True)),
            sa.Column("corrected_at", sa.DateTime(timezone=True)),
            # ─────────────────────────────────────────────────────────────────
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
            # Each student appears at most once per session
            sa.UniqueConstraint(
                "session_id",
                "student_id",
                name="uq_attendance_records_session_student",
            ),
            schema=schema,
        )

        op.create_index(
            "ix_attendance_records_session",
            "attendance_records",
            ["session_id"],
            schema=schema,
        )
        op.create_index(
            "ix_attendance_records_student_tenant",
            "attendance_records",
            ["tenant_id", "student_id"],
            schema=schema,
        )


def downgrade() -> None:
    op.drop_index("ix_attendance_records_student_tenant", table_name="attendance_records", schema="core")
    op.drop_index("ix_attendance_records_session", table_name="attendance_records", schema="core")
    op.drop_table("attendance_records", schema="core")

    op.drop_index("ix_attendance_sessions_term_status", table_name="attendance_sessions", schema="core")
    op.drop_index("ix_attendance_sessions_class_date", table_name="attendance_sessions", schema="core")
    op.execute("DROP INDEX IF EXISTS core.uq_attendance_sessions_period")
    op.execute("DROP INDEX IF EXISTS core.uq_attendance_sessions_daily")
    op.drop_table("attendance_sessions", schema="core")
