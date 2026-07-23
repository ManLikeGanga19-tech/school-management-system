"""widen core.backups.pg_dump_version

`pg_dump --version` returns strings like

    pg_dump (PostgreSQL) 18.0 (Debian 18.0-1.pgdg13+1)

which is ~54 chars and overflowed the original varchar(40), aborting the
final SUCCESS ledger write and failing the whole backup. Widen the column so
real version strings fit. (The service also truncates defensively — a backup
must never fail because of a cosmetic metadata string.)

Revision ID: bkp2widen1a2b
Revises: bkp1a2b3c4d5
"""
from alembic import op
import sqlalchemy as sa

revision = "bkp2widen1a2b"
down_revision = "bkp1a2b3c4d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "backups",
        "pg_dump_version",
        existing_type=sa.String(length=40),
        type_=sa.String(length=120),
        existing_nullable=True,
        schema="core",
    )


def downgrade() -> None:
    # Truncate any over-long values first so the narrowing cannot fail.
    op.execute(
        "UPDATE core.backups SET pg_dump_version = LEFT(pg_dump_version, 40) "
        "WHERE pg_dump_version IS NOT NULL"
    )
    op.alter_column(
        "backups",
        "pg_dump_version",
        existing_type=sa.String(length=120),
        type_=sa.String(length=40),
        existing_nullable=True,
        schema="core",
    )
