"""upgrade invoices: add term_number, academic_year, student_type_snapshot and duplicate guard

Revision ID: k4l5m6n7o8p9
Revises: j3k4l5m6n7o8
Create Date: 2026-03-30 08:20:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "k4l5m6n7o8p9"
down_revision: Union[str, None] = "j3k4l5m6n7o8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # term_number: 1 | 2 | 3
    op.add_column(
        "invoices",
        sa.Column("term_number", sa.SmallInteger(), nullable=True),
        schema="core",
    )

    # academic_year: e.g. 2026
    op.add_column(
        "invoices",
        sa.Column("academic_year", sa.SmallInteger(), nullable=True),
        schema="core",
    )

    # student_type_snapshot: captures student type at invoice creation time
    op.add_column(
        "invoices",
        sa.Column(
            "student_type_snapshot",
            sa.Enum("NEW", "RETURNING", name="student_type", schema="core",
                    create_type=False),  # reuse enum from fee_structures migration
            nullable=True,
        ),
        schema="core",
    )

    # Backfill existing invoices: use created_at year for academic_year,
    # term 1, RETURNING type (safe defaults for pre-existing data)
    op.execute("""
        UPDATE core.invoices
        SET
            term_number = 1,
            academic_year = EXTRACT(YEAR FROM created_at)::smallint,
            student_type_snapshot = 'RETURNING'
        WHERE term_number IS NULL
          AND invoice_type = 'SCHOOL_FEES'
    """)

    # Unique constraint: one SCHOOL_FEES invoice per student per term per year
    # Uses enrollment_id as the student anchor (enrollment links student + class + year)
    op.create_index(
        "uix_invoices_enrollment_term_year",
        "invoices",
        ["tenant_id", "enrollment_id", "term_number", "academic_year"],
        unique=True,
        postgresql_where=sa.text("invoice_type = 'SCHOOL_FEES' AND enrollment_id IS NOT NULL"),
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("uix_invoices_enrollment_term_year", table_name="invoices", schema="core")
    op.drop_column("invoices", "student_type_snapshot", schema="core")
    op.drop_column("invoices", "academic_year", schema="core")
    op.drop_column("invoices", "term_number", schema="core")
