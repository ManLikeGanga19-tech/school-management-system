from sqlalchemy import Column, Date, DateTime, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func, text

from app.core.database import Base


class TermReportRemarks(Base):
    __tablename__ = "term_report_remarks"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "student_enrollment_id", "term_id",
            name="uq_term_report_remarks_enrollment_term",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    student_enrollment_id = Column(UUID(as_uuid=True), nullable=False)
    term_id = Column(UUID(as_uuid=True), nullable=False)
    class_code = Column(String(80), nullable=False)

    class_teacher_comment = Column(Text)
    principal_comment = Column(Text)
    # EXCELLENT / VERY GOOD / GOOD / SATISFACTORY / UNSATISFACTORY
    conduct = Column(String(50))
    next_term_begins = Column(Date)

    # DRAFT / PUBLISHED
    status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    published_at = Column(DateTime(timezone=True))
    published_by_user_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
