import sqlalchemy as sa
from sqlalchemy import Column, DateTime, Index, SmallInteger, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func, text

from app.core.database import Base


class StudentClassEnrollment(Base):
    __tablename__ = "student_class_enrollments"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "student_id", "class_id", "term_id",
            name="uq_sce_student_class_term",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    student_id = Column(UUID(as_uuid=True), nullable=False)
    class_id = Column(UUID(as_uuid=True), nullable=False)
    term_id = Column(UUID(as_uuid=True), nullable=False)

    # ACTIVE / WITHDRAWN / TRANSFERRED
    status = Column(String(30), nullable=False, server_default=text("'ACTIVE'"))
    enrolled_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    withdrawn_at = Column(DateTime(timezone=True))
    notes = Column(String(500))
    created_by_user_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class AttendanceSession(Base):
    __tablename__ = "attendance_sessions"
    __table_args__ = (
        Index(
            "uq_attendance_sessions_daily",
            "tenant_id", "class_id", "session_date", "session_type",
            unique=True,
            postgresql_where=sa.text("session_type IN ('MORNING', 'AFTERNOON')"),
        ),
        Index(
            "uq_attendance_sessions_period",
            "tenant_id", "class_id", "session_date", "session_type", "subject_id", "period_number",
            unique=True,
            postgresql_where=sa.text("session_type = 'PERIOD'"),
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    class_id = Column(UUID(as_uuid=True), nullable=False)
    term_id = Column(UUID(as_uuid=True), nullable=False)
    subject_id = Column(UUID(as_uuid=True))

    session_date = Column(DateTime(timezone=False), nullable=False)
    # MORNING / AFTERNOON / PERIOD
    session_type = Column(String(30), nullable=False, server_default=text("'MORNING'"))
    period_number = Column(SmallInteger())
    # DRAFT / SUBMITTED / FINALIZED
    status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    notes = Column(String(500))

    marked_by_user_id = Column(UUID(as_uuid=True))
    submitted_at = Column(DateTime(timezone=True))
    finalized_by_user_id = Column(UUID(as_uuid=True))
    finalized_at = Column(DateTime(timezone=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_attendance_records_session_student"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    session_id = Column(UUID(as_uuid=True), nullable=False)
    enrollment_id = Column(UUID(as_uuid=True), nullable=False)
    student_id = Column(UUID(as_uuid=True), nullable=False)

    # PRESENT / ABSENT / LATE / EXCUSED / OFF_GROUNDS
    status = Column(String(30), nullable=False, server_default=text("'PRESENT'"))
    notes = Column(String(500))

    # Correction audit trail — populated only when a FINALIZED record is corrected
    original_status = Column(String(30))
    corrected_by_user_id = Column(UUID(as_uuid=True))
    corrected_at = Column(DateTime(timezone=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
