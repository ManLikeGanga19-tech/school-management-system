"""scholarship: FULL_WAIVER type + carry-forward flag + allocation status (Phase F1)

Three schema changes for the enterprise-grade scholarship rework:

  1. core.scholarships.covers_carry_forward BOOLEAN NOT NULL DEFAULT FALSE
     — when TRUE, a FULL_WAIVER also clears any carry-forward arrears that
     were bundled into the invoice. Default FALSE means a full waiver only
     covers the current term's fees; arrears remain billed (matches the
     real-world policy: bursaries usually don't retroactively erase debt).

  2. core.scholarship_allocations.status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
     — replaces the previous "hard-delete to release a slot" pattern. Cancel,
     replace, and enrollment-delete now soft-revoke (status='REVOKED') so the
     audit trail survives while budget/recipient counts ignore revoked rows.
     CHECK constraint enforces the allowed set.

  3. CHECK constraint on core.scholarships.type to include FULL_WAIVER alongside
     the existing PERCENTAGE and FIXED values.

Idempotent for any existing rows: covers_carry_forward defaults FALSE,
allocation status defaults ACTIVE (matches old hard-delete-on-release semantics
for in-flight rows — they were either ACTIVE or absent).
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "sch1f2w3a4v5"
down_revision: Union[str, None] = "t1y2n3r4y5z6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Scholarship: covers_carry_forward flag + type constraint extension.
    op.add_column(
        "scholarships",
        sa.Column(
            "covers_carry_forward",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema="core",
    )

    # Replace any existing CHECK on type with the wider set. The constraint
    # name is application-defined; drop conditionally for environments where
    # it was previously enforced application-side only.
    op.execute(
        """
        DO $$
        BEGIN
            ALTER TABLE core.scholarships
                DROP CONSTRAINT IF EXISTS scholarships_type_check;
        EXCEPTION WHEN undefined_object THEN NULL;
        END$$;
        """
    )
    op.create_check_constraint(
        "scholarships_type_check",
        "scholarships",
        "type IN ('PERCENTAGE', 'FIXED', 'FULL_WAIVER')",
        schema="core",
    )

    # 2) Allocation: lifecycle status.
    op.add_column(
        "scholarship_allocations",
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'ACTIVE'"),
        ),
        schema="core",
    )
    op.create_check_constraint(
        "scholarship_allocations_status_check",
        "scholarship_allocations",
        "status IN ('ACTIVE', 'REVOKED')",
        schema="core",
    )
    # Hot path: budget/recipient counts read by scholarship_id + status.
    op.create_index(
        "ix_scholarship_allocations_scholarship_status",
        "scholarship_allocations",
        ["scholarship_id", "status"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_scholarship_allocations_scholarship_status",
        table_name="scholarship_allocations",
        schema="core",
    )
    op.drop_constraint(
        "scholarship_allocations_status_check",
        "scholarship_allocations",
        schema="core",
        type_="check",
    )
    op.drop_column("scholarship_allocations", "status", schema="core")

    op.drop_constraint(
        "scholarships_type_check", "scholarships", schema="core", type_="check"
    )
    op.drop_column("scholarships", "covers_carry_forward", schema="core")
