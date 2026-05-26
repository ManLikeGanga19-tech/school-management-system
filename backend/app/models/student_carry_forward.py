from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Numeric, SmallInteger, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class StudentCarryForward(Base):
    """A student's balance adjustment — debit (owes) or credit (over-paid /
    goodwill / over-bill correction).

    status lifecycle:
        OPEN     -> waiting to be rolled into the next generated fees invoice
        BUNDLED  -> rolled into an invoice, awaiting payment
        SETTLED  -> the invoice paid down enough to cover this adjustment

    amount is signed:
        positive  -> DEBIT  (student owes more)
        negative  -> CREDIT (reduces the next invoice)
        zero      -> forbidden by check constraint
    """

    __tablename__ = "student_carry_forward_balances"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="ck_carry_forward_amount_nonzero"),
        CheckConstraint(
            "status IN ('OPEN', 'BUNDLED', 'SETTLED')",
            name="ck_carry_forward_status",
        ),
        CheckConstraint(
            "category IN ("
            "'MANUAL_DEBIT', "
            "'OVERPAYMENT_CREDIT', "
            "'GOODWILL_CREDIT', "
            "'OVERBILL_CORRECTION'"
            ")",
            name="ck_carry_forward_category",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(UUID(as_uuid=True), ForeignKey("core.students.id", ondelete="CASCADE"), nullable=False)

    term_label = Column(String(120), nullable=False)
    academic_year = Column(SmallInteger(), nullable=True)
    term_number = Column(SmallInteger(), nullable=True)

    amount = Column(Numeric(12, 2), nullable=False)
    description = Column(Text, nullable=True)

    category = Column(
        String(40),
        nullable=False,
        server_default=text("'MANUAL_DEBIT'"),
    )

    status = Column(
        String(20),
        nullable=False,
        server_default=text("'OPEN'"),
    )

    invoice_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.invoices.id", ondelete="SET NULL"),
        nullable=True,
    )

    recorded_by = Column(UUID(as_uuid=True), ForeignKey("core.users.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
