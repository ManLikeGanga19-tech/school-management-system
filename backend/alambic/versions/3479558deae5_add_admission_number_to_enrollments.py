"""add admission number to enrollments

Revision ID: 3479558deae5
Revises: f336775c23cd
Create Date: 2026-02-24 20:33:52.148155

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3479558deae5'
down_revision: Union[str, None] = 'f336775c23cd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _trigger_function_exists(conn, func_name: str, schema: str = "core") -> bool:
    result = conn.execute(
        sa.text(
            """
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = :schema
              AND p.proname = :func_name
            """
        ),
        {"schema": schema, "func_name": func_name},
    ).fetchone()
    return result is not None


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    conn = op.get_bind()

    # ------------------------------------------------------------------
    # 1. Add admission_number column
    # ------------------------------------------------------------------
    op.add_column(
        "enrollments",
        sa.Column("admission_number", sa.String(), nullable=True),
        schema="core",
    )

    # ------------------------------------------------------------------
    # 2. Partial unique constraint:
    #    (tenant_id, admission_number) WHERE admission_number IS NOT NULL
    #
    #    We use a raw CREATE UNIQUE INDEX because SQLAlchemy's
    #    UniqueConstraint does not support WHERE clauses via add_constraint.
    # ------------------------------------------------------------------
    op.execute(
        sa.text(
            """
            CREATE UNIQUE INDEX uq_enrollment_tenant_admission_number
                ON core.enrollments (tenant_id, admission_number)
                WHERE admission_number IS NOT NULL
            """
        )
    )

    # ------------------------------------------------------------------
    # 3. General-purpose indexes
    # ------------------------------------------------------------------
    # Only create if they don't already exist (idempotent-ish)
    existing_indexes = {
        row[0]
        for row in conn.execute(
            sa.text(
                """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = 'core'
                  AND tablename  = 'enrollments'
                """
            )
        ).fetchall()
    }

    if "ix_enrollments_tenant_id" not in existing_indexes:
        op.create_index(
            "ix_enrollments_tenant_id",
            "enrollments",
            ["tenant_id"],
            schema="core",
        )

    if "ix_enrollments_status" not in existing_indexes:
        op.create_index(
            "ix_enrollments_status",
            "enrollments",
            ["status"],
            schema="core",
        )

    op.create_index(
        "ix_enrollments_admission_number",
        "enrollments",
        ["admission_number"],
        schema="core",
    )

    # ------------------------------------------------------------------
    # 4. updated_at trigger
    #
    #    Creates a schema-level trigger function (once) then attaches it
    #    to the enrollments table.  Safe to run multiple times because
    #    CREATE OR REPLACE is used for the function.
    # ------------------------------------------------------------------
    op.execute(
        sa.text(
            """
            CREATE OR REPLACE FUNCTION core.set_updated_at()
            RETURNS TRIGGER
            LANGUAGE plpgsql
            AS $$
            BEGIN
                NEW.updated_at = NOW() AT TIME ZONE 'UTC';
                RETURN NEW;
            END;
            $$
            """
        )
    )

    # Drop trigger if it already exists (re-runnable)
    op.execute(
        sa.text(
            """
            DROP TRIGGER IF EXISTS trg_enrollments_set_updated_at
                ON core.enrollments
            """
        )
    )

    op.execute(
        sa.text(
            """
            CREATE TRIGGER trg_enrollments_set_updated_at
                BEFORE UPDATE ON core.enrollments
                FOR EACH ROW
                EXECUTE FUNCTION core.set_updated_at()
            """
        )
    )

    # ------------------------------------------------------------------
    # 5. Normalise legacy status values
    #
    #    FULLY_ENROLLED was the old name; UI expects "ENROLLED".
    #    ENROLLED_PARTIAL stays as-is.
    # ------------------------------------------------------------------
    op.execute(
        sa.text(
            """
            UPDATE core.enrollments
               SET status = 'ENROLLED'
             WHERE status = 'FULLY_ENROLLED'
            """
        )
    )

    # ------------------------------------------------------------------
    # 6. Backfill: if any existing records have admission_number stored
    #    inside their JSONB payload, promote it to the new column.
    # ------------------------------------------------------------------
    op.execute(
        sa.text(
            """
            UPDATE core.enrollments
               SET admission_number = payload->>'admission_number'
             WHERE admission_number IS NULL
               AND payload->>'admission_number' IS NOT NULL
               AND (payload->>'admission_number') <> ''
            """
        )
    )


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:
    # Remove trigger
    op.execute(
        sa.text(
            """
            DROP TRIGGER IF EXISTS trg_enrollments_set_updated_at
                ON core.enrollments
            """
        )
    )

    # Remove indexes
    op.execute(
        sa.text(
            "DROP INDEX IF EXISTS core.uq_enrollment_tenant_admission_number"
        )
    )
    op.drop_index(
        "ix_enrollments_admission_number",
        table_name="enrollments",
        schema="core",
    )

    # Reverse status normalisation best-effort
    # (we can't know which ENROLLED rows were originally FULLY_ENROLLED,
    #  so we leave them as ENROLLED — safe for a rollback scenario)

    # Remove column
    op.drop_column("enrollments", "admission_number", schema="core")
