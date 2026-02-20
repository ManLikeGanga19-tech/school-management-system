"""move enrollments back to core schema

Revision ID: d8a5483cb60d
Revises: 2b9fc5234726
Create Date: 2026-02-12 20:26:29.041363

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8a5483cb60d'
down_revision: Union[str, None] = '2b9fc5234726'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ensure schema exists
    op.execute("CREATE SCHEMA IF NOT EXISTS core")

    # move table (keeps data, constraints, indexes)
    op.execute("ALTER TABLE IF EXISTS enrollment.enrollments SET SCHEMA core")

    # optional: rename index to match new schema naming (only if it exists)
    op.execute("""
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'i'
          AND n.nspname = 'core'
          AND c.relname = 'ix_enrollment_enrollments_tenant_status'
      ) THEN
        EXECUTE 'ALTER INDEX core.ix_enrollment_enrollments_tenant_status RENAME TO ix_core_enrollments_tenant_status';
      END IF;
    END$$;
    """)

    # optional: drop old schema if empty
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname='enrollment'
      ) THEN
        EXECUTE 'DROP SCHEMA IF EXISTS enrollment';
      END IF;
    END$$;
    """)


def downgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS enrollment")

    # move table back
    op.execute("ALTER TABLE IF EXISTS core.enrollments SET SCHEMA enrollment")

    # rename index back if it was renamed
    op.execute("""
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'i'
          AND n.nspname = 'enrollment'
          AND c.relname = 'ix_core_enrollments_tenant_status'
      ) THEN
        EXECUTE 'ALTER INDEX enrollment.ix_core_enrollments_tenant_status RENAME TO ix_enrollment_enrollments_tenant_status';
      END IF;
    END$$;
    """)