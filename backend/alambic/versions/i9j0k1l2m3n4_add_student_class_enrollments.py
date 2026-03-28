"""add student class enrollments table

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-03-27 09:00:00.000000

student_class_enrollments — links a student to a specific class for a given
academic term.  This table is the prerequisite for attendance marking: only
students who are enrolled in a class for the current term may appear on the
attendance roster.

Status values:
  ACTIVE      — currently enrolled
  WITHDRAWN   — voluntarily left / moved to another school
  TRANSFERRED — transferred to a different class within the same school
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "i9j0k1l2m3n4"
down_revision: Union[str, None] = "h8i9j0k1l2m3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(schema_name: str, table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return bool(inspector.has_table(table_name, schema=schema_name))


def upgrade() -> None:
    schema = "core"
    table_name = "student_class_enrollments"

    if not _table_exists(schema, table_name):
        op.create_table(
            table_name,
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
            sa.Column(
                "class_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_classes.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "term_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_terms.id", ondelete="CASCADE"),
                nullable=False,
            ),
            # ACTIVE / WITHDRAWN / TRANSFERRED
            sa.Column(
                "status",
                sa.String(30),
                nullable=False,
                server_default=sa.text("'ACTIVE'"),
            ),
            sa.Column(
                "enrolled_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
            sa.Column("notes", sa.String(500)),
            sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True)),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            # A student can only be enrolled once per class + term within a tenant.
            sa.UniqueConstraint(
                "tenant_id",
                "student_id",
                "class_id",
                "term_id",
                name="uq_sce_student_class_term",
            ),
            schema=schema,
        )

        # Fast roster lookup: all enrollments for a class in a term
        op.create_index(
            "ix_sce_tenant_class_term",
            table_name,
            ["tenant_id", "class_id", "term_id"],
            schema=schema,
        )
        # Fast history lookup: all classes a student was ever enrolled in
        op.create_index(
            "ix_sce_tenant_student",
            table_name,
            ["tenant_id", "student_id"],
            schema=schema,
        )
        # Filter by status (active vs withdrawn)
        op.create_index(
            "ix_sce_tenant_class_term_status",
            table_name,
            ["tenant_id", "class_id", "term_id", "status"],
            schema=schema,
        )


def downgrade() -> None:
    op.drop_index("ix_sce_tenant_class_term_status", table_name="student_class_enrollments", schema="core")
    op.drop_index("ix_sce_tenant_student", table_name="student_class_enrollments", schema="core")
    op.drop_index("ix_sce_tenant_class_term", table_name="student_class_enrollments", schema="core")
    op.drop_table("student_class_enrollments", schema="core")
