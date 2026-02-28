"""add tenant HR, subjects, and assignment tables

Revision ID: n0p1q2r3s4t5
Revises: m9n0p1q2r3s4
Create Date: 2026-02-28 14:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "n0p1q2r3s4t5"
down_revision: Union[str, None] = "m9n0p1q2r3s4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_subjects",
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
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_tenant_subjects_tenant_code"),
        schema="core",
    )
    op.create_index(
        "ix_tenant_subjects_tenant_active",
        "tenant_subjects",
        ["tenant_id", "is_active"],
        unique=False,
        schema="core",
    )

    op.create_table(
        "staff_directory",
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
        sa.Column("staff_no", sa.String(length=64), nullable=False),
        sa.Column("staff_type", sa.String(length=32), nullable=False, server_default=sa.text("'TEACHING'")),
        sa.Column("employment_type", sa.String(length=32), nullable=True),
        sa.Column("first_name", sa.String(length=120), nullable=False),
        sa.Column("last_name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("id_number", sa.String(length=64), nullable=True),
        sa.Column("tsc_number", sa.String(length=64), nullable=True),
        sa.Column("kra_pin", sa.String(length=64), nullable=True),
        sa.Column("nssf_number", sa.String(length=64), nullable=True),
        sa.Column("nhif_number", sa.String(length=64), nullable=True),
        sa.Column("gender", sa.String(length=16), nullable=True),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("date_hired", sa.Date(), nullable=True),
        sa.Column("next_of_kin_name", sa.String(length=200), nullable=True),
        sa.Column("next_of_kin_relation", sa.String(length=120), nullable=True),
        sa.Column("next_of_kin_phone", sa.String(length=64), nullable=True),
        sa.Column("next_of_kin_email", sa.String(length=255), nullable=True),
        sa.Column("address", sa.String(length=500), nullable=True),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "staff_no", name="uq_staff_directory_tenant_staff_no"),
        schema="core",
    )
    op.create_index(
        "ix_staff_directory_tenant_type_active",
        "staff_directory",
        ["tenant_id", "staff_type", "is_active"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "uq_staff_directory_tenant_tsc",
        "staff_directory",
        ["tenant_id", "tsc_number"],
        unique=True,
        postgresql_where=sa.text("tsc_number IS NOT NULL"),
        schema="core",
    )

    op.create_table(
        "school_assets",
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
        sa.Column("asset_code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("condition_status", sa.String(length=32), nullable=False, server_default=sa.text("'AVAILABLE'")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "asset_code", name="uq_school_assets_tenant_code"),
        schema="core",
    )
    op.create_index(
        "ix_school_assets_tenant_category_active",
        "school_assets",
        ["tenant_id", "category", "is_active"],
        unique=False,
        schema="core",
    )

    op.create_table(
        "teacher_subject_assignments",
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
            "staff_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.staff_directory.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "subject_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.tenant_subjects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("class_code", sa.String(length=80), nullable=False),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("assigned_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema="core",
    )
    op.create_index(
        "ix_teacher_subject_assignments_tenant_staff",
        "teacher_subject_assignments",
        ["tenant_id", "staff_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_teacher_subject_assignments_tenant_subject_class",
        "teacher_subject_assignments",
        ["tenant_id", "subject_id", "class_code"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "uq_teacher_subject_per_class_active",
        "teacher_subject_assignments",
        ["tenant_id", "subject_id", "class_code"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
        schema="core",
    )

    op.create_table(
        "asset_assignments",
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
            "asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.school_assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "staff_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.staff_directory.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("assigned_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'ASSIGNED'")),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        schema="core",
    )
    op.create_index(
        "ix_asset_assignments_tenant_asset_status",
        "asset_assignments",
        ["tenant_id", "asset_id", "status"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_asset_assignments_tenant_staff",
        "asset_assignments",
        ["tenant_id", "staff_id"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_asset_assignments_tenant_staff", table_name="asset_assignments", schema="core")
    op.drop_index("ix_asset_assignments_tenant_asset_status", table_name="asset_assignments", schema="core")
    op.drop_table("asset_assignments", schema="core")

    op.drop_index("uq_teacher_subject_per_class_active", table_name="teacher_subject_assignments", schema="core")
    op.drop_index("ix_teacher_subject_assignments_tenant_subject_class", table_name="teacher_subject_assignments", schema="core")
    op.drop_index("ix_teacher_subject_assignments_tenant_staff", table_name="teacher_subject_assignments", schema="core")
    op.drop_table("teacher_subject_assignments", schema="core")

    op.drop_index("ix_school_assets_tenant_category_active", table_name="school_assets", schema="core")
    op.drop_table("school_assets", schema="core")

    op.drop_index("uq_staff_directory_tenant_tsc", table_name="staff_directory", schema="core")
    op.drop_index("ix_staff_directory_tenant_type_active", table_name="staff_directory", schema="core")
    op.drop_table("staff_directory", schema="core")

    op.drop_index("ix_tenant_subjects_tenant_active", table_name="tenant_subjects", schema="core")
    op.drop_table("tenant_subjects", schema="core")
