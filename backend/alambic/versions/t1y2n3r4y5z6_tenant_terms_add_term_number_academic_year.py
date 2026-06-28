"""tenant_terms: add term_number + academic_year columns with best-effort backfill

Revision ID: t1y2n3r4y5z6
Revises: c4r5y6f7b8a9
Create Date: 2026-06-15 00:00:00.000000

Two structured columns so every consumer (invoice generation, payment summary,
upcoming bulk-generation) can read the term identity deterministically instead
of regexing the human-readable name or code each time:

  term_number   SMALLINT  NULL  (1 | 2 | 3)
  academic_year SMALLINT  NULL  (e.g. 2026)

Both are nullable so existing data continues to round-trip even if backfill
can't infer a value. A CHECK constraint allows NULL or the valid set so a
bad value can never be written. Backfill uses regex against (code, name) to
seed the obvious cases; rows that don't match cleanly are left NULL for the
secretary to set explicitly under School Setup → Terms.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "t1y2n3r4y5z6"
down_revision: Union[str, None] = "c4r5y6f7b8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenant_terms",
        sa.Column("term_number", sa.SmallInteger(), nullable=True),
        schema="core",
    )
    op.add_column(
        "tenant_terms",
        sa.Column("academic_year", sa.SmallInteger(), nullable=True),
        schema="core",
    )

    # ── Best-effort backfill ───────────────────────────────────────────────
    # We only set values when the regex match is unambiguous. Patterns we cover:
    #   code:  T1-2026, T2_2026, TERM1-2026, TERM_3_2025, 2026-T2, 2026_T1
    #   name:  'Term 1 (2026)', 'Term 2 - 2026', 'Term 3 2025', 'Term 1 — 2026 / 2027'
    # When a name has multiple year-like tokens (e.g. '2026 / 2027'), we take
    # the FIRST 4-digit token in the range 2000–2199. term_number is the FIRST
    # digit 1–3 that follows a 'T' or 'Term'.
    # NB: avoid Postgres non-capturing groups (?:...) here — SQLAlchemy
    # interprets the ':' as a bind-parameter marker. Plain capturing groups
    # work; we pick the digit out of the deepest group either way.
    op.execute(
        sa.text(
            r"""
            UPDATE core.tenant_terms
            SET term_number = sub.t_num,
                academic_year = sub.t_year
            FROM (
                SELECT
                    id,
                    /* term number from 'T<n>' or 'Term <n>' in code OR name */
                    (
                        SELECT CAST(m[2] AS SMALLINT)
                        FROM regexp_matches(
                            UPPER(COALESCE(code, '') || ' ' || COALESCE(name, '')),
                            'T(ERM)?[\s_-]*([1-3])\y'
                        ) AS m
                        LIMIT 1
                    ) AS t_num,
                    /* academic year: first 4-digit token in 2000-2199 from code/name */
                    (
                        SELECT CAST(m[1] AS SMALLINT)
                        FROM regexp_matches(
                            COALESCE(code, '') || ' ' || COALESCE(name, ''),
                            '\y(2[01]\d{2})\y'
                        ) AS m
                        LIMIT 1
                    ) AS t_year
                FROM core.tenant_terms
            ) AS sub
            WHERE core.tenant_terms.id = sub.id
              AND sub.t_num IS NOT NULL
              AND sub.t_year IS NOT NULL
            """
        )
    )

    # CHECK constraint: allow NULL, or enforce the valid set.
    op.create_check_constraint(
        "ck_tenant_terms_term_number",
        "tenant_terms",
        "term_number IS NULL OR term_number IN (1, 2, 3)",
        schema="core",
    )
    op.create_check_constraint(
        "ck_tenant_terms_academic_year",
        "tenant_terms",
        "academic_year IS NULL OR (academic_year BETWEEN 2000 AND 2199)",
        schema="core",
    )

    # Helpful index for the invoice-generation form: "give me the current
    # term's (term_number, academic_year)" by tenant.
    op.create_index(
        "ix_tenant_terms_tenant_year_term",
        "tenant_terms",
        ["tenant_id", "academic_year", "term_number"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tenant_terms_tenant_year_term",
        table_name="tenant_terms",
        schema="core",
    )
    op.drop_constraint(
        "ck_tenant_terms_academic_year",
        "tenant_terms",
        schema="core",
        type_="check",
    )
    op.drop_constraint(
        "ck_tenant_terms_term_number",
        "tenant_terms",
        schema="core",
        type_="check",
    )
    op.drop_column("tenant_terms", "academic_year", schema="core")
    op.drop_column("tenant_terms", "term_number", schema="core")
