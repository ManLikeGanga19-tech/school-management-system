from sqlalchemy import Column, String, DateTime, ForeignKey, Numeric, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func

from app.core.database import Base


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)

    invoice_no = Column(String(50), nullable=True)
    invoice_type = Column(String(30), nullable=False)  # INTERVIEW|SCHOOL_FEES
    status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))

    enrollment_id = Column(UUID(as_uuid=True), ForeignKey("core.enrollments.id", ondelete="SET NULL"), nullable=True)

    currency = Column(String(10), nullable=False, server_default=text("'KES'"))
    total_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    paid_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    balance_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))

    meta = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("core.invoices.id", ondelete="CASCADE"), nullable=False)

    description = Column(String(200), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    meta = Column(JSONB, nullable=True)
