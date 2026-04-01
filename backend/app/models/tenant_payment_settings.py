from sqlalchemy import Column, DateTime, ForeignKey, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class TenantPaymentSettings(Base):
    __tablename__ = "tenant_payment_settings"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.tenants.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # M-PESA
    mpesa_paybill = Column(String(30), nullable=True)
    mpesa_business_no = Column(String(30), nullable=True)
    mpesa_account_format = Column(String(120), nullable=True)   # e.g. "Admission No."

    # Bank
    bank_name = Column(String(120), nullable=True)
    bank_account_name = Column(String(160), nullable=True)
    bank_account_number = Column(String(60), nullable=True)
    bank_branch = Column(String(120), nullable=True)

    # Cash / other payment instructions
    cash_payment_instructions = Column(Text(), nullable=True)

    # Uniform details block (printed on fee structure sheet)
    uniform_details_text = Column(Text(), nullable=True)

    # Assessment books (ONCE_PER_YEAR fee printed on structure sheet)
    assessment_books_amount = Column(Numeric(12, 2), nullable=True)
    assessment_books_note = Column(String(200), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
