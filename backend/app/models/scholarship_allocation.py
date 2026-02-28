from sqlalchemy import Column, DateTime, ForeignKey, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class ScholarshipAllocation(Base):
    __tablename__ = "scholarship_allocations"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    scholarship_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.scholarships.id", ondelete="CASCADE"),
        nullable=False,
    )
    enrollment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.enrollments.id", ondelete="SET NULL"),
        nullable=True,
    )
    invoice_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.invoices.id", ondelete="SET NULL"),
        nullable=True,
    )

    amount = Column(Numeric(12, 2), nullable=False)
    reason = Column(String(500), nullable=False)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
