"""create core.students base table

Revision ID: c4d5e6f7g8h9
Revises: c3d4e5f6g7h8
Create Date: 2026-03-29 00:00:00.000000

Creates the core.students table with base columns.
Extended bio-data columns are added in the next migration (d4e5f6g7h8i9).
Uses IF NOT EXISTS so it is safe on databases that already have the table
(e.g. local dev environments where the table was created outside Alembic).
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4d5e6f7g8h9"
down_revision: Union[str, None] = "c3d4e5f6g7h8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")

    op.execute("""
        CREATE TABLE IF NOT EXISTS core.students (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID        NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
            admission_no    VARCHAR(120) NOT NULL,
            first_name      VARCHAR(120) NOT NULL,
            last_name       VARCHAR(120) NOT NULL,
            other_names     VARCHAR(120),
            gender          VARCHAR(20),
            date_of_birth   DATE,
            status          VARCHAR(30)  NOT NULL DEFAULT 'ACTIVE',
            archived_at     TIMESTAMPTZ,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
        )
    """)

    # Indexes — IF NOT EXISTS guards against re-runs on existing DBs
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_students_tenant_admission
        ON core.students (tenant_id, admission_no)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_students_tenant_id
        ON core.students (tenant_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core.students CASCADE")
