"""add scholarship allocations table

Revision ID: l8m9n0p1q2r3
Revises: j6k7l8m9n0p1
Create Date: 2026-02-27 22:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "l8m9n0p1q2r3"
down_revision: Union[str, None] = "j6k7l8m9n0p1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "scholarship_allocations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "scholarship_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.scholarships.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "enrollment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.enrollments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "invoice_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.invoices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("amount > 0", name="ck_scholarship_allocations_amount_pos"),
        schema="core",
    )

    op.create_index(
        "ix_scholarship_allocations_tenant_scholarship",
        "scholarship_allocations",
        ["tenant_id", "scholarship_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_scholarship_allocations_tenant_enrollment",
        "scholarship_allocations",
        ["tenant_id", "enrollment_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_scholarship_allocations_tenant_created_at",
        "scholarship_allocations",
        ["tenant_id", "created_at"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_scholarship_allocations_tenant_created_at", table_name="scholarship_allocations", schema="core")
    op.drop_index("ix_scholarship_allocations_tenant_enrollment", table_name="scholarship_allocations", schema="core")
    op.drop_index("ix_scholarship_allocations_tenant_scholarship", table_name="scholarship_allocations", schema="core")
    op.drop_table("scholarship_allocations", schema="core")
