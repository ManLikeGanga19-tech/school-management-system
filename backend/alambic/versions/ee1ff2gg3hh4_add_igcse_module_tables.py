"""Add IGCSE subjects and scores tables

Revision ID: ee1ff2gg3hh4
Revises: dd1ee2ff3gg4
Create Date: 2026-04-04 11:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "ee1ff2gg3hh4"
down_revision: Union[str, tuple] = "dd1ee2ff3gg4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "igcse_subjects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "code", name="uq_igcse_subjects_tenant_code"),
        schema="core",
    )

    op.create_table(
        "igcse_scores",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("enrollment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("term_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("grade", sa.String(3), nullable=True),
        sa.Column("percentage", sa.Numeric(5, 2), nullable=True),
        sa.Column("effort", sa.String(2), nullable=True),
        sa.Column("teacher_comment", sa.Text(), nullable=True),
        sa.Column("assessed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("assessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint(
            "tenant_id", "enrollment_id", "subject_id", "term_id",
            name="uq_igcse_scores_enrollment_subject_term",
        ),
        schema="core",
    )

    op.create_index(
        "ix_igcse_scores_enrollment_term",
        "igcse_scores",
        ["enrollment_id", "term_id"],
        schema="core",
    )
    op.create_index(
        "ix_igcse_subjects_tenant",
        "igcse_subjects",
        ["tenant_id"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_table("igcse_scores", schema="core")
    op.drop_table("igcse_subjects", schema="core")
