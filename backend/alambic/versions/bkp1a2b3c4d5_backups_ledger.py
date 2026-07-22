"""backups ledger — platform backup audit trail (Phase 1, migration prep)

A platform-level (NOT tenant-scoped) record of every database backup taken
through the admin dashboard or the scheduled job. This table IS the audit
trail for the backup feature: who took it, when, outcome, size, and the
SHA-256 checksum used to verify integrity at restore time.

No tenant_id: a backup is the WHOLE database (all tenants), so it belongs
to the platform, not a tenant.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "bkp1a2b3c4d5"
down_revision: Union[str, None] = "kem1u2l3i4x5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "backups",
        sa.Column(
            "id", sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True, server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        # SaaS/platform user who triggered it (nullable = scheduled job).
        sa.Column("created_by", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False,
                  server_default=sa.text("'MANUAL'")),        # MANUAL | SCHEDULED
        sa.Column("status", sa.String(length=20), nullable=False,
                  server_default=sa.text("'RUNNING'")),       # RUNNING | SUCCESS | FAILED
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("db_table_data_count", sa.Integer(), nullable=True),
        sa.Column("media_file_count", sa.Integer(), nullable=True),
        sa.Column("alembic_head", sa.String(length=64), nullable=True),
        sa.Column("pg_dump_version", sa.String(length=40), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('RUNNING', 'SUCCESS', 'FAILED')",
            name="ck_backups_status",
        ),
        sa.CheckConstraint(
            "kind IN ('MANUAL', 'SCHEDULED')",
            name="ck_backups_kind",
        ),
        schema="core",
    )
    op.create_index(
        "ix_backups_created_at", "backups", ["created_at"], schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_backups_created_at", table_name="backups", schema="core")
    op.drop_table("backups", schema="core")
