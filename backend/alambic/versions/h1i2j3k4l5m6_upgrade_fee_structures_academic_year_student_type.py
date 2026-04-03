"""upgrade fee_structures: add academic_year and student_type

Revision ID: h1i2j3k4l5m6
Revises: g0h1i2j3k4l5
Create Date: 2026-03-30 08:05:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "h1i2j3k4l5m6"
down_revision: Union[str, None] = "g0h1i2j3k4l5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create student_type enum
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE core.student_type AS ENUM ('NEW', 'RETURNING');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    # Add academic_year (e.g. 2026)
    op.add_column(
        "fee_structures",
        sa.Column("academic_year", sa.SmallInteger(), nullable=True),
        schema="core",
    )

    # Add student_type (NEW | RETURNING)
    op.add_column(
        "fee_structures",
        sa.Column(
            "student_type",
            sa.Enum("NEW", "RETURNING", name="student_type", schema="core"),
            nullable=True,
        ),
        schema="core",
    )

    # Backfill academic_year from created_at for existing structures
    op.execute("""
        UPDATE core.fee_structures
        SET academic_year = EXTRACT(YEAR FROM created_at)::smallint
        WHERE academic_year IS NULL
    """)

    # Backfill student_type to RETURNING for all existing structures
    op.execute("""
        UPDATE core.fee_structures
        SET student_type = 'RETURNING'
        WHERE student_type IS NULL
    """)

    # Deduplicate: old schema allowed one structure per (tenant, class, term_code).
    # New schema is one per (tenant, class, academic_year, student_type).
    # Keep the earliest-created structure in each duplicate group; delete the rest
    # along with their items so the unique constraint can be applied cleanly.
    op.execute("""
        DELETE FROM core.fee_structure_items
        WHERE structure_id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY tenant_id, class_code, academic_year, student_type
                           ORDER BY created_at ASC
                       ) AS rn
                FROM core.fee_structures
            ) ranked
            WHERE rn > 1
        )
    """)
    op.execute("""
        DELETE FROM core.fee_structures
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY tenant_id, class_code, academic_year, student_type
                           ORDER BY created_at ASC
                       ) AS rn
                FROM core.fee_structures
            ) ranked
            WHERE rn > 1
        )
    """)

    op.alter_column("fee_structures", "academic_year", nullable=False, schema="core")
    op.alter_column("fee_structures", "student_type", nullable=False, schema="core")

    # Drop the old unique constraint
    op.drop_constraint(
        "uq_fee_structures_tenant_class_term",
        "fee_structures",
        schema="core",
    )

    # New unique constraint: tenant + class + academic_year + student_type
    op.create_unique_constraint(
        "uq_fee_structures_tenant_class_year_type",
        "fee_structures",
        ["tenant_id", "class_code", "academic_year", "student_type"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_fee_structures_tenant_class_year_type",
        "fee_structures",
        schema="core",
    )
    op.create_unique_constraint(
        "uq_fee_structures_tenant_class_term",
        "fee_structures",
        ["tenant_id", "class_code", "term_code"],
        schema="core",
    )
    op.drop_column("fee_structures", "student_type", schema="core")
    op.drop_column("fee_structures", "academic_year", schema="core")
    op.execute("""
        DO $$ BEGIN
            DROP TYPE core.student_type;
        EXCEPTION WHEN undefined_object THEN NULL;
        END $$;
    """)
