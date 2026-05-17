"""add tenant_groups for multi-campus

A tenant group is the Enterprise customer; each campus stays a full,
isolated tenant linked to the group via tenants.group_id. The group
carries the shared subscription tier (plan_code + period_end), which
every campus inherits.

Revision ID: g1r2o3u4p5s6
Revises: u3p4l5a6n6s7
Create Date: 2026-05-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "g1r2o3u4p5s6"
down_revision = "u3p4l5a6n6s7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False, unique=True),
        sa.Column("billing_email", sa.String(length=200), nullable=True),
        sa.Column("primary_contact", sa.String(length=200), nullable=True),
        # Shared subscription tier for every campus in the group.
        sa.Column("plan_code", sa.String(length=64), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        schema="core",
    )

    op.add_column(
        "tenants",
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="core",
    )
    op.create_foreign_key(
        "fk_tenants_group_id",
        "tenants",
        "tenant_groups",
        ["group_id"],
        ["id"],
        source_schema="core",
        referent_schema="core",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_core_tenants_group_id", "tenants", ["group_id"], schema="core"
    )


def downgrade() -> None:
    op.drop_index("ix_core_tenants_group_id", table_name="tenants", schema="core")
    op.drop_constraint("fk_tenants_group_id", "tenants", schema="core", type_="foreignkey")
    op.drop_column("tenants", "group_id", schema="core")
    op.drop_table("tenant_groups", schema="core")
