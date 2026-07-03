import secrets

from sqlalchemy import CheckConstraint, Column, String, DateTime, ForeignKey, Numeric, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


def _new_verify_code() -> str:
    """Opaque, unguessable code for document QR verification (~72-bit)."""
    return secrets.token_urlsafe(12)


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)

    provider = Column(String(30), nullable=False)  # CASH|MPESA|BANK|CHEQUE
    reference = Column(String(100), nullable=True)
    receipt_no = Column(String(50), nullable=True)

    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(10), nullable=False, server_default=text("'KES'"))

    # Phase R — direct student linkage. Set for by-student waterfall payments
    # and any payment whose allocations resolve to exactly one student.
    # NULL for multi-student family payments (no single payer student).
    # This is what lets zero-allocation payments (CF-only settlements,
    # no-dues credit payments) still identify who they were for.
    student_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.students.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Opaque, unguessable code embedded in the receipt QR (/v/{verify_code}).
    verify_code = Column(
        String(32), nullable=True, unique=True, index=True, default=_new_verify_code
    )

    received_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(UUID(as_uuid=True), nullable=True)


class PaymentAllocation(Base):
    __tablename__ = "payment_allocations"
    __table_args__ = (
        UniqueConstraint("payment_id", "invoice_id", name="uq_payment_invoice_alloc"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    payment_id = Column(UUID(as_uuid=True), ForeignKey("core.payments.id", ondelete="CASCADE"), nullable=False)
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("core.invoices.id", ondelete="CASCADE"), nullable=False)

    amount = Column(Numeric(12, 2), nullable=False)


class PaymentCFAllocation(Base):
    """Phase R — the missing half of the payment ledger.

    Mirrors PaymentAllocation for carry-forward rows: one row per CF the
    payment touched, so receipts and the payments table can itemise CF
    settlements relationally instead of reading audit-event whispers.

    kind:
        SETTLEMENT      — cash from this payment applied to a CF DEBIT.
                          Counts toward the cash reconciliation:
                          invoice allocations + CF settlements + surplus
                          credit == payment.amount.
        CREDIT_CONSUMED — an OPEN credit spent as additional funding
                          (apply_available_credit). Informational: NOT
                          cash, excluded from the cash reconciliation.
    """

    __tablename__ = "payment_cf_allocations"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_payment_cf_alloc_amount_pos"),
        CheckConstraint(
            "kind IN ('SETTLEMENT', 'CREDIT_CONSUMED')",
            name="ck_payment_cf_alloc_kind",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    payment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.payments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    carry_forward_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.student_carry_forward_balances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    amount = Column(Numeric(12, 2), nullable=False)
    kind = Column(String(20), nullable=False, server_default=text("'SETTLEMENT'"))

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
