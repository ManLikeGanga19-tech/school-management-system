"""IGCSE assessment models."""
from sqlalchemy import (
    Boolean, Column, DateTime, Integer, Numeric, String, Text, UniqueConstraint, text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class IgcseSubject(Base):
    """Tenant-level IGCSE subject catalogue (e.g. Mathematics, Biology, History)."""
    __tablename__ = "igcse_subjects"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_igcse_subjects_tenant_code"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    name = Column(String(200), nullable=False)
    code = Column(String(50), nullable=False)   # e.g. "MATH", "BIO"
    display_order = Column(Integer, nullable=False, server_default=text("0"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class IgcseScore(Base):
    """Per-student per-subject score for a given term."""
    __tablename__ = "igcse_scores"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "enrollment_id", "subject_id", "term_id",
            name="uq_igcse_scores_enrollment_subject_term",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    enrollment_id = Column(UUID(as_uuid=True), nullable=False)  # student_class_enrollment
    student_id = Column(UUID(as_uuid=True), nullable=True)      # denormalized
    subject_id = Column(UUID(as_uuid=True), nullable=False)
    term_id = Column(UUID(as_uuid=True), nullable=False)

    grade = Column(String(3), nullable=True)          # A*, A, B, C, D, E, F, G, U
    percentage = Column(Numeric(5, 2), nullable=True) # 0.00-100.00
    effort = Column(String(2), nullable=True)          # 1-5 (star rating)
    teacher_comment = Column(Text, nullable=True)

    assessed_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    assessed_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
