"""ORM models for Phase 3B — CBC Assessments."""
from __future__ import annotations

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, SmallInteger,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func, text

from app.core.database import Base


class CbcLearningArea(Base):
    """Top-level subject equivalent (e.g. 'English Language')."""
    __tablename__ = "cbc_learning_areas"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", "grade_band", name="uq_cbc_la_tenant_code_band"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(120), nullable=False)
    code = Column(String(30), nullable=False)
    # LOWER_PRIMARY / UPPER_PRIMARY / JUNIOR_SECONDARY
    grade_band = Column(String(30), nullable=False)
    display_order = Column(SmallInteger, nullable=False, server_default=text("0"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class CbcStrand(Base):
    """Major topic within a learning area."""
    __tablename__ = "cbc_strands"
    __table_args__ = (
        UniqueConstraint("tenant_id", "learning_area_id", "code", name="uq_cbc_strand_tenant_la_code"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    learning_area_id = Column(UUID(as_uuid=True), ForeignKey("core.cbc_learning_areas.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False)
    code = Column(String(30), nullable=False)
    display_order = Column(SmallInteger, nullable=False, server_default=text("0"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class CbcSubStrand(Base):
    """Specific assessable skill within a strand."""
    __tablename__ = "cbc_sub_strands"
    __table_args__ = (
        UniqueConstraint("tenant_id", "strand_id", "code", name="uq_cbc_ss_tenant_strand_code"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    strand_id = Column(UUID(as_uuid=True), ForeignKey("core.cbc_strands.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False)
    code = Column(String(30), nullable=False)
    display_order = Column(SmallInteger, nullable=False, server_default=text("0"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class CbcAssessment(Base):
    """One assessment row per learner per sub-strand per term.

    assessment_type distinguishes:
    - SUMMATIVE (default) — end-of-term; unique per (enrollment, sub_strand, term).
      Enforced by partial unique index uq_cbc_summative in the DB.
    - FORMATIVE — continuous; unique per (enrollment, sub_strand, term, checkpoint_no).
      Enforced by partial unique index uq_cbc_formative in the DB.

    Performance levels: BE / AE / ME / EE
    """
    __tablename__ = "cbc_assessments"
    __table_args__ = (
        # NOTE: the old unique constraint was replaced by two partial indexes
        # created in migration a1b2c3d4e5f6. The ORM table_args only needs
        # the schema declaration now.
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    enrollment_id = Column(UUID(as_uuid=True), ForeignKey("core.student_class_enrollments.id", ondelete="CASCADE"), nullable=False)
    # Denormalised for fast queries
    student_id = Column(UUID(as_uuid=True), ForeignKey("core.students.id", ondelete="CASCADE"), nullable=False)
    sub_strand_id = Column(UUID(as_uuid=True), ForeignKey("core.cbc_sub_strands.id", ondelete="CASCADE"), nullable=False)
    term_id = Column(UUID(as_uuid=True), ForeignKey("core.tenant_terms.id", ondelete="CASCADE"), nullable=False)

    # SUMMATIVE (default) | FORMATIVE
    assessment_type = Column(String(12), nullable=False, server_default="SUMMATIVE")
    # For FORMATIVE only: which checkpoint (1, 2, 3 …)
    checkpoint_no = Column(SmallInteger, nullable=False, server_default=text("1"))

    # BE / AE / ME / EE
    performance_level = Column(String(2), nullable=False)
    teacher_observations = Column(Text)

    assessed_by_user_id = Column(UUID(as_uuid=True), ForeignKey("core.users.id", ondelete="SET NULL"))
    assessed_at = Column(DateTime(timezone=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
