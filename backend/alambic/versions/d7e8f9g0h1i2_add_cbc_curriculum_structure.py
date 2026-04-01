"""add CBC curriculum structure tables

Revision ID: d7e8f9g0h1i2
Revises: a4b5c6d7e8f9
Create Date: 2026-03-29 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d7e8f9g0h1i2"
down_revision: Union[str, None] = "a4b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── cbc_learning_areas ────────────────────────────────────────────────────
    op.create_table(
        "cbc_learning_areas",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("grade_band", sa.String(30), nullable=False),
        sa.Column("display_order", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", "grade_band", name="uq_cbc_la_tenant_code_band"),
        schema="core",
    )
    op.create_index("ix_cbc_la_tenant", "cbc_learning_areas", ["tenant_id"], schema="core")

    # ── cbc_strands ───────────────────────────────────────────────────────────
    op.create_table(
        "cbc_strands",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("learning_area_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.cbc_learning_areas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("display_order", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "learning_area_id", "code", name="uq_cbc_strand_tenant_la_code"),
        schema="core",
    )
    op.create_index("ix_cbc_strands_la", "cbc_strands", ["learning_area_id"], schema="core")

    # ── cbc_sub_strands ───────────────────────────────────────────────────────
    op.create_table(
        "cbc_sub_strands",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("strand_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.cbc_strands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("display_order", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "strand_id", "code", name="uq_cbc_ss_tenant_strand_code"),
        schema="core",
    )
    op.create_index("ix_cbc_ss_strand", "cbc_sub_strands", ["strand_id"], schema="core")


def downgrade() -> None:
    op.drop_table("cbc_sub_strands", schema="core")
    op.drop_table("cbc_strands", schema="core")
    op.drop_table("cbc_learning_areas", schema="core")
