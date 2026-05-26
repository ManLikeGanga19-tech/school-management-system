"""carry-forward: support credits + categories + new status labels

Revision ID: c4r5y6f7b8a9
Revises: r3m4d5i6a7l8
Create Date: 2026-05-26 00:00:00.000000

Three changes to student_carry_forward_balances so it can model both DEBIT
(student owes more) and CREDIT (student is owed) adjustments, with clearer
status names that read naturally for either side:

1. Rename status values:
     PENDING  -> OPEN     (waiting to be rolled into the next invoice)
     INCLUDED -> BUNDLED  (rolled into a generated invoice, awaiting payment)
     CLEARED  -> SETTLED  (paid down to zero against the invoice it was on)

2. Drop the "amount > 0" check; allow negative amounts (credits). Forbid 0.

3. Add a required `category` column so debits/credits are tagged with the
   reason — useful in the audit log and the Adjust Balance UI. Existing rows
   are backfilled to 'MANUAL_DEBIT' (they were positive arrears entries).
"""
from alembic import op
import sqlalchemy as sa


revision = "c4r5y6f7b8a9"
down_revision = "r3m4d5i6a7l8"
branch_labels = None
depends_on = None


_OLD_TO_NEW_STATUS = {
    "PENDING": "OPEN",
    "INCLUDED": "BUNDLED",
    "CLEARED": "SETTLED",
}

_CATEGORIES = (
    "MANUAL_DEBIT",          # Secretary adds a debit (paper arrears, missed payment).
    "OVERPAYMENT_CREDIT",    # Auto — parent paid more than the invoice balance.
    "GOODWILL_CREDIT",       # Manual goodwill credit (bursary, discretion).
    "OVERBILL_CORRECTION",   # Manual — we over-billed, this corrects it (credit).
)


def upgrade() -> None:
    # 1. Status rename — drop the old check, update values, re-create.
    op.drop_constraint(
        "ck_carry_forward_status",
        "student_carry_forward_balances",
        schema="core",
        type_="check",
    )
    for old, new in _OLD_TO_NEW_STATUS.items():
        op.execute(
            sa.text(
                "UPDATE core.student_carry_forward_balances "
                "SET status = :new WHERE status = :old"
            ).bindparams(old=old, new=new)
        )
    op.alter_column(
        "student_carry_forward_balances",
        "status",
        server_default=sa.text("'OPEN'"),
        schema="core",
    )
    op.create_check_constraint(
        "ck_carry_forward_status",
        "student_carry_forward_balances",
        "status IN ('OPEN', 'BUNDLED', 'SETTLED')",
        schema="core",
    )

    # 2. Allow credits (negative). amount must just be non-zero.
    op.drop_constraint(
        "ck_carry_forward_amount_positive",
        "student_carry_forward_balances",
        schema="core",
        type_="check",
    )
    op.create_check_constraint(
        "ck_carry_forward_amount_nonzero",
        "student_carry_forward_balances",
        "amount <> 0",
        schema="core",
    )

    # 3. Required category — backfill existing rows as MANUAL_DEBIT, then NOT NULL.
    op.add_column(
        "student_carry_forward_balances",
        sa.Column("category", sa.String(40), nullable=True),
        schema="core",
    )
    op.execute(
        "UPDATE core.student_carry_forward_balances "
        "SET category = 'MANUAL_DEBIT' WHERE category IS NULL"
    )
    op.alter_column(
        "student_carry_forward_balances",
        "category",
        nullable=False,
        server_default=sa.text("'MANUAL_DEBIT'"),
        schema="core",
    )
    op.create_check_constraint(
        "ck_carry_forward_category",
        "student_carry_forward_balances",
        "category IN ("
        + ", ".join(f"'{c}'" for c in _CATEGORIES)
        + ")",
        schema="core",
    )


def downgrade() -> None:
    # Reverse: rebuild positive-only amount check, status enum, drop category.
    op.drop_constraint(
        "ck_carry_forward_category",
        "student_carry_forward_balances",
        schema="core",
        type_="check",
    )
    op.drop_column(
        "student_carry_forward_balances", "category", schema="core"
    )

    op.drop_constraint(
        "ck_carry_forward_amount_nonzero",
        "student_carry_forward_balances",
        schema="core",
        type_="check",
    )
    op.create_check_constraint(
        "ck_carry_forward_amount_positive",
        "student_carry_forward_balances",
        "amount > 0",
        schema="core",
    )

    op.drop_constraint(
        "ck_carry_forward_status",
        "student_carry_forward_balances",
        schema="core",
        type_="check",
    )
    for old, new in _OLD_TO_NEW_STATUS.items():
        op.execute(
            sa.text(
                "UPDATE core.student_carry_forward_balances "
                "SET status = :old WHERE status = :new"
            ).bindparams(old=old, new=new)
        )
    op.alter_column(
        "student_carry_forward_balances",
        "status",
        server_default=sa.text("'PENDING'"),
        schema="core",
    )
    op.create_check_constraint(
        "ck_carry_forward_status",
        "student_carry_forward_balances",
        "status IN ('PENDING', 'INCLUDED', 'CLEARED')",
        schema="core",
    )
