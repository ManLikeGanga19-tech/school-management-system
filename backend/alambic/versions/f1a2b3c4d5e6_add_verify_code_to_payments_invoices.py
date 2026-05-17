"""add verify_code to payments and invoices

Adds an opaque, unguessable per-document verification code used by the
QR codes on receipts and invoices. The QR encodes only a short URL
(/v/{verify_code}); verification is a live DB lookup, so a forged code
simply has no matching row.

This revision also merges the two open heads
(a9f3d1c7b8e1, gg2hh3ii4jj5) into one.

Revision ID: f1a2b3c4d5e6
Revises: a9f3d1c7b8e1, gg2hh3ii4jj5
Create Date: 2026-05-17 00:00:00.000000

"""
import secrets

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f1a2b3c4d5e6"
down_revision = ("a9f3d1c7b8e1", "gg2hh3ii4jj5")
branch_labels = None
depends_on = None


def _backfill(table: str) -> None:
    """Assign a unique verify_code to every existing row that lacks one."""
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(f"SELECT id FROM core.{table} WHERE verify_code IS NULL")
    ).fetchall()
    used: set[str] = set()
    for (row_id,) in rows:
        code = secrets.token_urlsafe(12)
        while code in used:
            code = secrets.token_urlsafe(12)
        used.add(code)
        conn.execute(
            sa.text(
                f"UPDATE core.{table} SET verify_code = :code WHERE id = :id"
            ),
            {"code": code, "id": row_id},
        )


def upgrade() -> None:
    for table in ("payments", "invoices"):
        op.add_column(
            table,
            sa.Column("verify_code", sa.String(length=32), nullable=True),
            schema="core",
        )
        _backfill(table)
        op.create_index(
            f"ix_core_{table}_verify_code",
            table,
            ["verify_code"],
            unique=True,
            schema="core",
        )


def downgrade() -> None:
    for table in ("payments", "invoices"):
        op.drop_index(f"ix_core_{table}_verify_code", table_name=table, schema="core")
        op.drop_column(table, "verify_code", schema="core")
