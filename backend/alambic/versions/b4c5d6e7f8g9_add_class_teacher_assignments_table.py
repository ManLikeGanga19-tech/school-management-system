"""add class teacher assignments table

Revision ID: b4c5d6e7f8g9
Revises: a4b5c6d7e8f9
Create Date: 2026-03-03 11:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "b4c5d6e7f8g9"
down_revision: Union[str, None] = "a4b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "class_teacher_assignments",
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
        sa.Column("class_code", sa.String(length=80), nullable=False),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("assigned_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema="core",
    )

    op.create_index(
        "ix_class_teacher_assignments_tenant_staff",
        "class_teacher_assignments",
        ["tenant_id", "staff_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_class_teacher_assignments_tenant_class",
        "class_teacher_assignments",
        ["tenant_id", "class_code"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "uq_class_teacher_per_class_active",
        "class_teacher_assignments",
        ["tenant_id", "class_code"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "uq_class_teacher_per_class_active",
        table_name="class_teacher_assignments",
        schema="core",
    )
    op.drop_index(
        "ix_class_teacher_assignments_tenant_class",
        table_name="class_teacher_assignments",
        schema="core",
    )
    op.drop_index(
        "ix_class_teacher_assignments_tenant_staff",
        table_name="class_teacher_assignments",
        schema="core",
    )
    op.drop_table("class_teacher_assignments", schema="core")
