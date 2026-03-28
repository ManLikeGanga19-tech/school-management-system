"""add term report card remarks table

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-03-27 10:00:00.000000

term_report_remarks — stores the narrative header for an 8-4-4 term report
card: class-teacher comment, principal comment, conduct grade, and publication
status.  The actual marks live in core.tenant_exam_marks.

One row per student-enrollment + term.  DRAFT until explicitly published.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "l2m3n4o5p6q7"
down_revision: Union[str, None] = "k1l2m3n4o5p6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(schema_name: str, table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return bool(inspector.has_table(table_name, schema=schema_name))


def upgrade() -> None:
    schema = "core"
    table_name = "term_report_remarks"

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
            # References core.enrollments.id (the admission enrollment record)
            sa.Column(
                "student_enrollment_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.enrollments.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "term_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("core.tenant_terms.id", ondelete="CASCADE"),
                nullable=False,
            ),
            # Denormalised for reporting convenience (avoids join through marks)
            sa.Column("class_code", sa.String(80), nullable=False),
            # Narrative remarks
            sa.Column("class_teacher_comment", sa.Text()),
            sa.Column("principal_comment", sa.Text()),
            # EXCELLENT / VERY GOOD / GOOD / SATISFACTORY / UNSATISFACTORY
            sa.Column("conduct", sa.String(50)),
            # Next-term return date
            sa.Column("next_term_begins", sa.Date()),
            # DRAFT → PUBLISHED
            sa.Column(
                "status",
                sa.String(30),
                nullable=False,
                server_default=sa.text("'DRAFT'"),
            ),
            sa.Column("published_at", sa.DateTime(timezone=True)),
            sa.Column("published_by_user_id", postgresql.UUID(as_uuid=True)),
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
            sa.UniqueConstraint(
                "tenant_id",
                "student_enrollment_id",
                "term_id",
                name="uq_term_report_remarks_enrollment_term",
            ),
            schema=schema,
        )

        op.create_index(
            "ix_trr_tenant_class_term",
            table_name,
            ["tenant_id", "class_code", "term_id"],
            schema=schema,
        )
        op.create_index(
            "ix_trr_tenant_term_status",
            table_name,
            ["tenant_id", "term_id", "status"],
            schema=schema,
        )


def downgrade() -> None:
    op.drop_index("ix_trr_tenant_term_status", table_name="term_report_remarks", schema="core")
    op.drop_index("ix_trr_tenant_class_term", table_name="term_report_remarks", schema="core")
    op.drop_table("term_report_remarks", schema="core")
