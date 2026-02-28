"""add term-aware fee structures and structure policy table

Revision ID: j6k7l8m9n0p1
Revises: i5j6k7l8m9n0
Create Date: 2026-02-27 19:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "j6k7l8m9n0p1"
down_revision: Union[str, None] = "i5j6k7l8m9n0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "fee_structures",
        sa.Column("term_code", sa.String(length=80), nullable=False, server_default=sa.text("'GENERAL'")),
        schema="core",
    )
    op.drop_constraint(
        "uq_fee_structures_tenant_class",
        "fee_structures",
        type_="unique",
        schema="core",
    )
    op.create_unique_constraint(
        "uq_fee_structures_tenant_class_term",
        "fee_structures",
        ["tenant_id", "class_code", "term_code"],
        schema="core",
    )

    op.create_table(
        "finance_structure_policies",
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
            "fee_structure_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.fee_structures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "fee_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.fee_items.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("allow_partial_enrollment", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("min_percent_to_enroll", sa.Integer(), nullable=True),
        sa.Column("min_amount_to_enroll", sa.Numeric(12, 2), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema="core",
    )

    op.create_index(
        "ix_finance_structure_policies_tenant_structure",
        "finance_structure_policies",
        ["tenant_id", "fee_structure_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ux_finance_structure_policy_structure_scope",
        "finance_structure_policies",
        ["tenant_id", "fee_structure_id"],
        unique=True,
        schema="core",
        postgresql_where=sa.text("fee_item_id IS NULL"),
    )
    op.create_index(
        "ux_finance_structure_policy_item_scope",
        "finance_structure_policies",
        ["tenant_id", "fee_structure_id", "fee_item_id"],
        unique=True,
        schema="core",
        postgresql_where=sa.text("fee_item_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_finance_structure_policy_item_scope", table_name="finance_structure_policies", schema="core")
    op.drop_index("ux_finance_structure_policy_structure_scope", table_name="finance_structure_policies", schema="core")
    op.drop_index("ix_finance_structure_policies_tenant_structure", table_name="finance_structure_policies", schema="core")
    op.drop_table("finance_structure_policies", schema="core")

    op.drop_constraint(
        "uq_fee_structures_tenant_class_term",
        "fee_structures",
        type_="unique",
        schema="core",
    )
    op.create_unique_constraint(
        "uq_fee_structures_tenant_class",
        "fee_structures",
        ["tenant_id", "class_code"],
        schema="core",
    )
    op.drop_column("fee_structures", "term_code", schema="core")
