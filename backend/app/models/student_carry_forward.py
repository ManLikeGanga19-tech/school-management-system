from sqlalchemy import Column, DateTime, ForeignKey, Numeric, SmallInteger, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class StudentCarryForward(Base):
    """Records a student's outstanding fee balance carried forward from paper records
    or a previous term not captured in the system.

    status lifecycle: PENDING -> INCLUDED (linked to an invoice) -> CLEARED (invoice paid)
    """

    __tablename__ = "student_carry_forward_balances"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(UUID(as_uuid=True), ForeignKey("core.students.id", ondelete="CASCADE"), nullable=False)

    # Human-readable label for the source term/period
    term_label = Column(String(120), nullable=False)          # e.g. "Term 2 2024"
    academic_year = Column(SmallInteger(), nullable=True)     # e.g. 2024
    term_number = Column(SmallInteger(), nullable=True)       # 1 | 2 | 3

    amount = Column(Numeric(12, 2), nullable=False)           # outstanding balance (must be > 0)
    description = Column(Text, nullable=True)                 # optional note from school admin

    # Workflow status
    status = Column(
        String(20),
        nullable=False,
        server_default=text("'PENDING'"),
    )                                                         # PENDING | INCLUDED | CLEARED

    # When included/cleared, link to the invoice
    invoice_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.invoices.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Audit
    recorded_by = Column(UUID(as_uuid=True), ForeignKey("core.users.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
