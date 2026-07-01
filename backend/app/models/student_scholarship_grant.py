"""Student-level scholarship attachment.

A grant links a student to a scholarship at the student level (not
per-invoice). Every subsequent invoice generated for that student
auto-inherits the discount at v2 generation time.

Lifecycle:
  ACTIVE   -> currently in force; v2 generator + apply-to-existing paths
              use it.
  REVOKED  -> soft-terminated; kept for audit; will not be applied again.
              revoked_at + revoked_by + revoked_reason must be set.

Optional scope (both nullable):
  academic_year — grant only applies to invoices for this year
  term_number   — grant only applies to invoices for this term

Both NULL means "any term / any year going forward" — the common case
for a multi-year bursary.

Grant does NOT store an amount — the discount is derived from the
scholarship's type at apply time (FIXED / PERCENTAGE / FULL_WAIVER).
This means updating the scholarship value flows through automatically
to every current grant, matching how school-fee waivers actually work.
"""
from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class StudentScholarshipGrant(Base):
    __tablename__ = "student_scholarship_grants"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ACTIVE', 'REVOKED')",
            name="ck_student_scholarship_grants_status",
        ),
        CheckConstraint(
            "term_number IS NULL OR term_number BETWEEN 1 AND 3",
            name="ck_student_scholarship_grants_term_number",
        ),
        CheckConstraint(
            "(status = 'ACTIVE' AND revoked_at IS NULL) OR "
            "(status = 'REVOKED' AND revoked_at IS NOT NULL "
            "                     AND revoked_reason IS NOT NULL)",
            name="ck_student_scholarship_grants_revoke_consistency",
        ),
        # Hot-path index for v2 generator lookups.
        Index(
            "ix_student_scholarship_grants_lookup",
            "tenant_id", "student_id", "status",
        ),
        {"schema": "core"},
    )

    id = Column(
        UUID(as_uuid=True), primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    student_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.students.id", ondelete="CASCADE"),
        nullable=False,
    )
    scholarship_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.scholarships.id", ondelete="RESTRICT"),
        nullable=False,
    )

    academic_year = Column(SmallInteger, nullable=True)
    term_number = Column(SmallInteger, nullable=True)

    status = Column(
        String(20), nullable=False, server_default=text("'ACTIVE'"),
    )

    granted_reason = Column(String(500), nullable=False)
    granted_by = Column(UUID(as_uuid=True), nullable=True)
    granted_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    revoked_reason = Column(String(500), nullable=True)
    revoked_by = Column(UUID(as_uuid=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
