"""create core.parents and core.parent_students base tables

Revision ID: d5e6f7g8h9i0
Revises: d4e5f6g7h8i9
Create Date: 2026-03-29 00:00:00.000000

Creates the two parent-related tables that were previously only created via
SQLAlchemy metadata.create_all() on local dev environments:

  core.parents         — guardian records (base columns only; extended by
                         e5f6g7h8i9j0_extend_parent_contact_fields)
  core.parent_students — junction table linking parents to students

Both tables use IF NOT EXISTS so the migration is a safe no-op on databases
that already have the tables (e.g. local dev environments).
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d5e6f7g8h9i0"
down_revision: Union[str, None] = "d4e5f6g7h8i9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")

    # Base parent record (extended in e5f6g7h8i9j0)
    op.execute("""
        CREATE TABLE IF NOT EXISTS core.parents (
            id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id      UUID         NOT NULL,
            user_id        UUID         UNIQUE,
            national_id    VARCHAR(100),
            occupation     VARCHAR(120),
            is_active      BOOLEAN      NOT NULL DEFAULT true,
            archived_at    TIMESTAMPTZ,
            created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_parents_tenant_id
        ON core.parents (tenant_id)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_parents_user_id
        ON core.parents (user_id)
    """)

    # Junction: parent ↔ student
    op.execute("""
        CREATE TABLE IF NOT EXISTS core.parent_students (
            tenant_id    UUID         NOT NULL,
            parent_id    UUID         NOT NULL REFERENCES core.parents(id)  ON DELETE CASCADE,
            student_id   UUID         NOT NULL REFERENCES core.students(id) ON DELETE CASCADE,
            relationship VARCHAR(50)  NOT NULL DEFAULT 'GUARDIAN',
            is_active    BOOLEAN      NOT NULL DEFAULT true,
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
            PRIMARY KEY (tenant_id, parent_id, student_id)
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_parent_students_parent_id
        ON core.parent_students (parent_id)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_parent_students_student_id
        ON core.parent_students (student_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core.parent_students CASCADE")
    op.execute("DROP TABLE IF EXISTS core.parents CASCADE")
