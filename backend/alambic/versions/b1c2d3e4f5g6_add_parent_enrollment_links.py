"""add core.parent_enrollment_links and phone unique index on core.parents

Revision ID: b1c2d3e4f5g6
Revises: ii4jj5kk6ll7
Create Date: 2026-04-13 00:00:00.000000

Adds:
  core.parent_enrollment_links — junction table linking a parent to an
      enrollment record (rather than a student record).  Enrollment-based
      linking is required for the finance workflow because invoices reference
      enrollment_id, and a student may not yet have a student_id set.

  unique index (tenant_id, phone) on core.parents — enables the
      sync-from-enrollments auto-deduplication by guardian_phone.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "b1c2d3e4f5g6"
down_revision: Union[str, None] = "ii4jj5kk6ll7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Unique phone per tenant for deduplication during sync
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uix_parents_tenant_phone
        ON core.parents (tenant_id, phone)
        WHERE phone IS NOT NULL
    """)

    # Parent ↔ Enrollment junction
    op.execute("""
        CREATE TABLE IF NOT EXISTS core.parent_enrollment_links (
            id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID         NOT NULL,
            parent_id     UUID         NOT NULL REFERENCES core.parents(id) ON DELETE CASCADE,
            enrollment_id UUID         NOT NULL REFERENCES core.enrollments(id) ON DELETE CASCADE,
            relationship  VARCHAR(50)  NOT NULL DEFAULT 'GUARDIAN',
            is_primary    BOOLEAN      NOT NULL DEFAULT false,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            UNIQUE (parent_id, enrollment_id)
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_parent_enrollment_links_parent_id
        ON core.parent_enrollment_links (parent_id)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_parent_enrollment_links_enrollment_id
        ON core.parent_enrollment_links (enrollment_id)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_parent_enrollment_links_tenant_id
        ON core.parent_enrollment_links (tenant_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core.parent_enrollment_links CASCADE")
    op.execute("DROP INDEX IF EXISTS core.uix_parents_tenant_phone")
