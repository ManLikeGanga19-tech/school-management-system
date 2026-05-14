"""Seed Kenya 2026 national academic calendar and add parent_portal_tokens table

Revision ID: d0e1f2g3h4i5
Revises: c7d8e9f0a1b2
Create Date: 2026-05-14 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d0e1f2g3h4i5"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


KENYA_2026_TERMS = [
    {
        "term_no": 1,
        "term_code": "2026-T1",
        "term_name": "Term 1 — 2026",
        "start_date": "2026-01-06",
        "end_date": "2026-04-03",
    },
    {
        "term_no": 2,
        "term_code": "2026-T2",
        "term_name": "Term 2 — 2026",
        "start_date": "2026-05-04",
        "end_date": "2026-08-07",
    },
    {
        "term_no": 3,
        "term_code": "2026-T3",
        "term_name": "Term 3 — 2026",
        "start_date": "2026-09-01",
        "end_date": "2026-11-27",
    },
]


def upgrade() -> None:
    # ── 1. parent_portal_tokens ──────────────────────────────────────────────
    op.create_table(
        "parent_portal_tokens",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parent_id", sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.parents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.Text, nullable=False),
        sa.Column("label", sa.String(160), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema="core",
    )
    op.create_index(
        "uq_parent_portal_tokens_hash",
        "parent_portal_tokens",
        ["token_hash"],
        unique=True,
        schema="core",
        postgresql_where=sa.text("is_active = true"),
    )
    op.create_index(
        "ix_parent_portal_tokens_parent",
        "parent_portal_tokens",
        ["tenant_id", "parent_id"],
        schema="core",
        postgresql_where=sa.text("is_active = true"),
    )

    # ── 2. Kenya 2026 national academic calendar ─────────────────────────────
    conn = op.get_bind()
    for t in KENYA_2026_TERMS:
        conn.execute(
            sa.text("""
                INSERT INTO core.saas_academic_calendar_terms
                    (academic_year, term_no, term_code, term_name, start_date, end_date, is_active)
                VALUES
                    (:yr, :no, :code, :name, :start, :end, true)
                ON CONFLICT DO NOTHING
            """),
            {"yr": 2026, "no": t["term_no"], "code": t["term_code"],
             "name": t["term_name"], "start": t["start_date"], "end": t["end_date"]},
        )

    # ── 3. Sync national calendar to all active tenants ──────────────────────
    # For each tenant that doesn't already have a term_code, upsert from the
    # national calendar. This ensures all tenants get the Kenya 2026 dates
    # regardless of when they were onboarded.
    for t in KENYA_2026_TERMS:
        conn.execute(
            sa.text("""
                INSERT INTO core.tenant_terms (tenant_id, code, name, start_date, end_date, is_active)
                SELECT
                    ten.id,
                    :code,
                    :name,
                    :start ::date,
                    :end ::date,
                    true
                FROM core.tenants ten
                WHERE ten.is_active = true
                  AND NOT EXISTS (
                      SELECT 1 FROM core.tenant_terms tt
                      WHERE tt.tenant_id = ten.id AND tt.code = :code
                  )
            """),
            {"code": t["term_code"], "name": t["term_name"],
             "start": t["start_date"], "end": t["end_date"]},
        )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM core.saas_academic_calendar_terms WHERE academic_year = 2026")
    )
    op.execute(
        sa.text("DELETE FROM core.tenant_terms WHERE code IN ('2026-T1', '2026-T2', '2026-T3')")
    )
    op.drop_index("ix_parent_portal_tokens_parent", table_name="parent_portal_tokens", schema="core")
    op.drop_index("uq_parent_portal_tokens_hash", table_name="parent_portal_tokens", schema="core")
    op.drop_table("parent_portal_tokens", schema="core")
