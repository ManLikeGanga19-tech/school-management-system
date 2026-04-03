"""add student_carry_forward_balances table

Revision ID: aa1bb2cc3dd4
Revises: z3a4b5c6d7e8
Create Date: 2026-04-03 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aa1bb2cc3dd4"
down_revision: Union[str, None] = "z3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "student_carry_forward_balances",
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
            "student_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.students.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("term_label", sa.String(120), nullable=False),
        sa.Column("academic_year", sa.SmallInteger(), nullable=True),
        sa.Column("term_number", sa.SmallInteger(), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'PENDING'"),
        ),
        sa.Column(
            "invoice_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.invoices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "recorded_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("amount > 0", name="ck_carry_forward_amount_positive"),
        sa.CheckConstraint(
            "status IN ('PENDING', 'INCLUDED', 'CLEARED')",
            name="ck_carry_forward_status",
        ),
        schema="core",
    )

    op.create_index(
        "ix_carry_forward_student",
        "student_carry_forward_balances",
        ["tenant_id", "student_id", "status"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_carry_forward_student", table_name="student_carry_forward_balances", schema="core")
    op.drop_table("student_carry_forward_balances", schema="core")
