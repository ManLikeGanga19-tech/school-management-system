"""payment student link + CF allocations: complete the payment ledger (Phase R)

Two structural gaps exposed by the Phase N waterfall:

1. ``core.payments`` had NO student linkage — identity was only derivable
   via PaymentAllocation → Invoice → Enrollment → Student. Phase N
   introduced legitimate zero-allocation payments (carry-forward-only
   settlements, no-dues credit payments), which therefore rendered as
   "(N/A) student, 0 invoices" everywhere.
   → Adds ``payments.student_id`` (nullable FK) + index, and backfills:
       a) from ``payment.waterfall.applied`` audit events (Phase N
          payments recorded their student_id in the event payload), then
       b) from the allocation chain for any remaining single-student
          payments (multi-student family payments stay NULL by design —
          there is no single payer student).

2. Carry-forward settlements had NO relational record — the waterfall
   bumped ``settled_amount`` and wrote an audit event, but there was no
   row linking payment ↔ carry-forward ↔ amount, unlike invoice
   allocations which get first-class PaymentAllocation rows. Half a
   ledger.
   → Adds ``core.payment_cf_allocations``:
       * payment_id / carry_forward_id FKs
       * amount (> 0)
       * kind: 'SETTLEMENT'      — cash from this payment applied to a
                                    CF debit (counts toward the cash
                                    reconciliation: invoice allocations
                                    + CF settlements + surplus == amount)
               'CREDIT_CONSUMED' — an OPEN credit spent as extra funding
                                    (informational; NOT cash, excluded
                                    from the cash reconciliation)

   Historical CF settlements are NOT backfilled — the audit events carry
   the amounts but not reliably enough to fabricate ledger rows from
   (they remain visible in the audit trail). The table is authoritative
   from this migration forward.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "pcf1a2b3c4d5"
down_revision: Union[str, None] = "wtr1f2a3l4l5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. payments.student_id ────────────────────────────────────────────
    op.add_column(
        "payments",
        sa.Column(
            "student_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.students.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema="core",
    )
    op.create_index(
        "ix_payments_student_id",
        "payments",
        ["student_id"],
        schema="core",
    )

    # Backfill (a): Phase N waterfall payments — the audit event payload
    # recorded the student the payment was for. Guarded casts: skip any
    # malformed UUID rather than aborting the migration.
    op.execute(
        """
        UPDATE core.payments p
        SET student_id = (al.payload->>'student_id')::uuid
        FROM core.audit_logs al
        WHERE al.action = 'payment.waterfall.applied'
          AND al.resource_id = p.id
          AND al.tenant_id = p.tenant_id
          AND p.student_id IS NULL
          AND al.payload->>'student_id' ~ '^[0-9a-fA-F-]{36}$'
          AND EXISTS (
              SELECT 1 FROM core.students s
              WHERE s.id = (al.payload->>'student_id')::uuid
                AND s.tenant_id = p.tenant_id
          )
        """
    )

    # Backfill (b): remaining payments whose allocations resolve to exactly
    # ONE student — set that student. Family payments spanning siblings
    # stay NULL (no single payer student exists by design).
    op.execute(
        """
        UPDATE core.payments p
        SET student_id = sub.student_id
        FROM (
            SELECT pa.payment_id,
                   MIN(e.student_id::text)::uuid AS student_id
            FROM core.payment_allocations pa
            JOIN core.invoices i     ON i.id = pa.invoice_id
            JOIN core.enrollments e  ON e.id = i.enrollment_id
            WHERE e.student_id IS NOT NULL
            GROUP BY pa.payment_id
            HAVING COUNT(DISTINCT e.student_id) = 1
        ) sub
        WHERE p.id = sub.payment_id
          AND p.student_id IS NULL
        """
    )

    # ── 2. payment_cf_allocations ─────────────────────────────────────────
    op.create_table(
        "payment_cf_allocations",
        sa.Column(
            "id", sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True, server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "payment_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.payments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "carry_forward_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "core.student_carry_forward_balances.id", ondelete="CASCADE"
            ),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column(
            "kind", sa.String(length=20),
            nullable=False, server_default=sa.text("'SETTLEMENT'"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.CheckConstraint("amount > 0", name="ck_payment_cf_alloc_amount_pos"),
        sa.CheckConstraint(
            "kind IN ('SETTLEMENT', 'CREDIT_CONSUMED')",
            name="ck_payment_cf_alloc_kind",
        ),
        schema="core",
    )
    op.create_index(
        "ix_payment_cf_allocations_payment_id",
        "payment_cf_allocations",
        ["payment_id"],
        schema="core",
    )
    op.create_index(
        "ix_payment_cf_allocations_carry_forward_id",
        "payment_cf_allocations",
        ["carry_forward_id"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_payment_cf_allocations_carry_forward_id",
        table_name="payment_cf_allocations", schema="core",
    )
    op.drop_index(
        "ix_payment_cf_allocations_payment_id",
        table_name="payment_cf_allocations", schema="core",
    )
    op.drop_table("payment_cf_allocations", schema="core")
    op.drop_index("ix_payments_student_id", table_name="payments", schema="core")
    op.drop_column("payments", "student_id", schema="core")
