"""ORM models for tenant_subjects, tenant_exams, and tenant_exam_marks."""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TenantSubject(Base):
    __tablename__ = "tenant_subjects"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_tenant_subjects_tenant_code"),
        {"schema": "core"},
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    code: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"))
    created_at: Mapped[sa.DateTime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
    updated_at: Mapped[sa.DateTime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )


class TenantExam(Base):
    __tablename__ = "tenant_exams"
    __table_args__ = {"schema": "core"}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    class_code: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    subject_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    term_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    start_date: Mapped[sa.Date] = mapped_column(sa.Date, nullable=False)
    end_date: Mapped[sa.Date] = mapped_column(sa.Date, nullable=False)
    start_time: Mapped[sa.Time | None] = mapped_column(sa.Time, nullable=True)
    status: Mapped[str] = mapped_column(
        sa.String(32), nullable=False, server_default=sa.text("'SCHEDULED'")
    )
    location: Mapped[str | None] = mapped_column(sa.String(160), nullable=True)
    notes: Mapped[str | None] = mapped_column(sa.String(1000), nullable=True)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"))
    created_at: Mapped[sa.DateTime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
    updated_at: Mapped[sa.DateTime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )


class TenantExamMark(Base):
    __tablename__ = "tenant_exam_marks"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "exam_id", "student_enrollment_id", "subject_id",
            name="uq_tenant_exam_marks_exam_student_subject",
        ),
        {"schema": "core"},
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    exam_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    student_enrollment_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    subject_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    class_code: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    marks_obtained: Mapped[float] = mapped_column(
        sa.Numeric(7, 2), nullable=False, server_default=sa.text("0")
    )
    max_marks: Mapped[float] = mapped_column(
        sa.Numeric(7, 2), nullable=False, server_default=sa.text("100")
    )
    grade: Mapped[str | None] = mapped_column(sa.String(16), nullable=True)
    remarks: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    recorded_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    recorded_at: Mapped[sa.DateTime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
    updated_at: Mapped[sa.DateTime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
