"""carry_forward_settled_amount: track partial direct-payment settlement (Phase N1)

Adds a ``settled_amount`` column to ``core.student_carry_forward_balances`` so
we can record partial cash settlement of an OPEN carry-forward debit without
mutating the original ``amount`` or spawning split rows.

Motivation (Phase N — Payment Waterfall):
    When a parent pays cash and the waterfall applies part of it to an OPEN
    carry-forward debit, we need to record how much of the CF has been paid
    down. Three options were considered:
        A. Mutate the ``amount`` column — destroys audit trail (original
           amount lost).
        B. Split into two CF rows (settled + remaining) — ugly proliferation
           of tiny rows, breaks single-source-of-truth for the original debt.
        C. Add ``settled_amount`` column — preserves the original amount,
           tracks partial settlement, status still flips to SETTLED once
           settled_amount == abs(amount). **Chosen.**

Semantics:
    * settled_amount defaults to 0 for every existing row (backfill-safe).
    * settled_amount is non-negative and never exceeds abs(amount).
    * "outstanding" for a DEBIT is abs(amount) - settled_amount.
    * status flips OPEN -> SETTLED when settled_amount == abs(amount).
    * status='SETTLED' with settled_amount > 0 is the direct-payment case;
      status='SETTLED' with settled_amount == 0 is the legacy path (invoice
      generation rolled it into an invoice which was then paid) — both remain
      valid, distinguished by settled_amount.

This is purely additive — no existing code path breaks, and every existing
consumer that reads ``amount`` continues to work unchanged.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "wtr1f2a3l4l5"
down_revision: Union[str, None] = "grn7m8s9c1p2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "student_carry_forward_balances",
        sa.Column(
            "settled_amount",
            sa.Numeric(12, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
        schema="core",
    )
    op.create_check_constraint(
        "ck_carry_forward_settled_amount_nonneg",
        "student_carry_forward_balances",
        "settled_amount >= 0",
        schema="core",
    )
    op.create_check_constraint(
        "ck_carry_forward_settled_amount_bound",
        "student_carry_forward_balances",
        "settled_amount <= ABS(amount)",
        schema="core",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_carry_forward_settled_amount_bound",
        "student_carry_forward_balances",
        type_="check",
        schema="core",
    )
    op.drop_constraint(
        "ck_carry_forward_settled_amount_nonneg",
        "student_carry_forward_balances",
        type_="check",
        schema="core",
    )
    op.drop_column(
        "student_carry_forward_balances",
        "settled_amount",
        schema="core",
    )
