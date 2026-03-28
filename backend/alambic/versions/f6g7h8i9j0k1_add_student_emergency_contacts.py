"""add student_emergency_contacts table

Revision ID: f6g7h8i9j0k1
Revises: e5f6g7h8i9j0
Create Date: 2026-03-27 08:30:00.000000

Emergency contacts are non-guardian contacts who should be notified
or can collect the student in an emergency. Separate from core.parents.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f6g7h8i9j0k1"
down_revision: Union[str, None] = "e5f6g7h8i9j0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(schema: str, table: str) -> bool:
    bind = op.get_bind()
    return bind.dialect.has_table(bind, table, schema=schema)


def upgrade() -> None:
    if _table_exists("core", "student_emergency_contacts"):
        return

    op.create_table(
        "student_emergency_contacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=False),

        sa.Column("name",         sa.String(120), nullable=False),
        sa.Column("relationship", sa.String(80)),   # UNCLE, AUNT, GRANDPARENT, etc.
        sa.Column("phone",        sa.String(50), nullable=False),
        sa.Column("phone_alt",    sa.String(50)),
        sa.Column("email",        sa.String(200)),
        sa.Column("is_primary",   sa.Boolean, nullable=False,
                  server_default=sa.text("false")),
        sa.Column("notes",        sa.String(500)),

        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),

        sa.ForeignKeyConstraint(
            ["tenant_id"], ["core.tenants.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["student_id"], ["core.students.id"], ondelete="CASCADE"
        ),
        schema="core",
    )

    op.create_index(
        "ix_student_emergency_contacts_student",
        "student_emergency_contacts",
        ["tenant_id", "student_id"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_student_emergency_contacts_student",
        table_name="student_emergency_contacts",
        schema="core",
    )
    op.drop_table("student_emergency_contacts", schema="core")
