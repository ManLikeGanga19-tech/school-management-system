"""student_scholarship_grants: student-level scholarship attachment (Phase M2)

Attaches a scholarship to a student at the student level rather than
per-invoice. Every subsequent invoice generated for that student
auto-inherits the discount at generation time — no more
"remember to click Apply Scholarship on each new term's invoice".

Schema:
  * (tenant_id, student_id, scholarship_id, status) — partial unique index
    on ACTIVE only, so a student can have at most one ACTIVE grant of any
    given scholarship at a time but can accumulate REVOKED history rows.
  * Optional (academic_year, term_number) scope — grant applies only when
    invoice matches. NULL means "applies to any term/year going forward".
  * status: ACTIVE | REVOKED — soft-lifecycle so the audit trail survives
    revocation. Matches the same shape as scholarship_allocations.status.
  * revoked_at / revoked_by / revoked_reason: filled by the revoke endpoint.
  * CHECK constraints enforce status enum + non-negative term_number when set.

The grant does NOT store an amount — that's driven by the scholarship
type at invoice-generation time (FIXED / PERCENTAGE / FULL_WAIVER):
per Phase F, the amount is a policy of the scholarship, not the grant.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "grn7m8s9c1p2"
down_revision: Union[str, None] = "sch1f2w3a4v5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "student_scholarship_grants",
        sa.Column(
            "id", sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True, server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "student_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.students.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "scholarship_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.scholarships.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("academic_year", sa.SmallInteger(), nullable=True),
        sa.Column("term_number", sa.SmallInteger(), nullable=True),
        sa.Column(
            "status", sa.String(length=20),
            nullable=False, server_default=sa.text("'ACTIVE'"),
        ),
        sa.Column("granted_reason", sa.String(length=500), nullable=False),
        sa.Column(
            "granted_by", sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "granted_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.text("now()"),
        ),
        sa.Column("revoked_reason", sa.String(length=500), nullable=True),
        sa.Column(
            "revoked_by", sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'REVOKED')",
            name="ck_student_scholarship_grants_status",
        ),
        sa.CheckConstraint(
            "term_number IS NULL OR term_number BETWEEN 1 AND 3",
            name="ck_student_scholarship_grants_term_number",
        ),
        sa.CheckConstraint(
            # REVOKED rows must have the revoked_* fields filled; ACTIVE
            # rows must not (a REVOKED row without a reason is
            # forensically useless).
            "(status = 'ACTIVE' AND revoked_at IS NULL) OR "
            "(status = 'REVOKED' AND revoked_at IS NOT NULL "
            "                     AND revoked_reason IS NOT NULL)",
            name="ck_student_scholarship_grants_revoke_consistency",
        ),
        schema="core",
    )

    # Partial unique index — a student can only have ONE ACTIVE grant
    # for a given scholarship at a time. REVOKED history rows don't
    # conflict, so the same scholarship can be re-granted after revocation.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_student_scholarship_grants_active
        ON core.student_scholarship_grants
        (tenant_id, student_id, scholarship_id)
        WHERE status = 'ACTIVE'
        """
    )

    # Hot-path index: v2 generator queries by (tenant_id, student_id,
    # status) on every school-fees invoice creation.
    op.create_index(
        "ix_student_scholarship_grants_lookup",
        "student_scholarship_grants",
        ["tenant_id", "student_id", "status"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_student_scholarship_grants_lookup",
        table_name="student_scholarship_grants",
        schema="core",
    )
    op.execute(
        "DROP INDEX IF EXISTS core.uq_student_scholarship_grants_active"
    )
    op.drop_table("student_scholarship_grants", schema="core")
