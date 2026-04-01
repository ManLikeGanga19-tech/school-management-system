"""add CBC assessments table

Revision ID: e8f9g0h1i2j3
Revises: d7e8f9g0h1i2
Create Date: 2026-03-29 10:05:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e8f9g0h1i2j3"
down_revision: Union[str, None] = "d7e8f9g0h1i2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cbc_assessments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("enrollment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.student_class_enrollments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sub_strand_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.cbc_sub_strands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("term_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenant_terms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("performance_level", sa.String(2), nullable=False),
        sa.Column("teacher_observations", sa.Text()),
        sa.Column("assessed_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.users.id", ondelete="SET NULL")),
        sa.Column("assessed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint(
            "tenant_id", "enrollment_id", "sub_strand_id", "term_id",
            name="uq_cbc_assessment_enrollment_substrand_term",
        ),
        schema="core",
    )
    op.create_index("ix_cbc_assessments_enrollment", "cbc_assessments", ["enrollment_id"], schema="core")
    op.create_index("ix_cbc_assessments_student_term", "cbc_assessments", ["student_id", "term_id"], schema="core")


def downgrade() -> None:
    op.drop_table("cbc_assessments", schema="core")
