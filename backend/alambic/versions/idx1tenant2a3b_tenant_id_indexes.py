"""add missing tenant_id indexes

Audit of the production schema (2026-07-23) found 3 of the 70 tenant-scoped
tables carrying a tenant_id column with no index on it. Every tenant-filtered
query against them is a sequential scan, which is invisible at today's data
volume and increasingly expensive as schools are onboarded:

    auth_sessions          touched on authenticated requests -- hot path
    cbc_assessments        grows per student x subject x term
    discipline_followups

Created CONCURRENTLY so the migration never takes an ACCESS EXCLUSIVE lock on a
live table. That requires running outside a transaction, hence the
autocommit_block; IF NOT EXISTS keeps the migration re-runnable if a
CONCURRENTLY build is interrupted (which leaves an INVALID index behind).

Revision ID: idx1tenant2a3b
Revises: bkp2widen1a2b
"""
from alembic import op

revision = "idx1tenant2a3b"
down_revision = "bkp2widen1a2b"
branch_labels = None
depends_on = None

INDEXES = [
    ("ix_core_auth_sessions_tenant_id", "auth_sessions"),
    ("ix_core_cbc_assessments_tenant_id", "cbc_assessments"),
    ("ix_core_discipline_followups_tenant_id", "discipline_followups"),
]


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for index_name, table in INDEXES:
            op.execute(
                f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{index_name}" '
                f'ON core."{table}" (tenant_id)'
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for index_name, _table in INDEXES:
            op.execute(f'DROP INDEX CONCURRENTLY IF EXISTS core."{index_name}"')
