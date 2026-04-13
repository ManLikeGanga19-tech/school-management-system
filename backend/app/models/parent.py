from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class Parent(Base):
    __tablename__ = "parents"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), unique=True)

    # Contact fields
    first_name = Column(String(120))
    last_name = Column(String(120))
    phone = Column(String(50))
    phone_alt = Column(String(50))
    email = Column(String(200))
    id_type = Column(String(30))        # NATIONAL_ID, PASSPORT, OTHER
    national_id = Column(String(100))
    occupation = Column(String(120))
    address = Column(Text)

    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    archived_at = Column(DateTime(timezone=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ParentStudent(Base):
    """Junction: parent ↔ student ownership (legacy — kept for SIS compatibility)."""
    __tablename__ = "parent_students"
    __table_args__ = {"schema": "core"}

    tenant_id = Column(UUID(as_uuid=True), primary_key=True)
    parent_id = Column(UUID(as_uuid=True), primary_key=True)
    student_id = Column(UUID(as_uuid=True), primary_key=True)

    relationship = Column(String(50), nullable=False, server_default=text("'GUARDIAN'"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ParentEnrollmentLink(Base):
    """Junction: parent ↔ enrollment.

    Used by the finance workflow — invoices are keyed on enrollment_id and
    the guardian contact data lives in the enrollment payload.  A parent can
    be linked to many enrollments (one per child), and each enrollment can
    have many parents/guardians.
    """
    __tablename__ = "parent_enrollment_links"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.parents.id", ondelete="CASCADE"),
        nullable=False,
    )
    enrollment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.enrollments.id", ondelete="CASCADE"),
        nullable=False,
    )
    relationship = Column(String(50), nullable=False, server_default=text("'GUARDIAN'"))
    is_primary = Column(Boolean, nullable=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
