"""add school calendar tables

Revision ID: i1j2k3l4m5n6
Revises: h0i1j2k3l4m5
Create Date: 2026-03-12 18:30:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "i1j2k3l4m5n6"
down_revision: Union[str, None] = "h0i1j2k3l4m5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
    op.execute("CREATE SCHEMA IF NOT EXISTS core")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.saas_academic_calendar_terms (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            academic_year INT NOT NULL,
            term_no SMALLINT NOT NULL CHECK (term_no BETWEEN 1 AND 3),
            term_code VARCHAR(64) NOT NULL,
            term_name VARCHAR(160) NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_saas_academic_calendar_terms_year_no UNIQUE (academic_year, term_no)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_saas_academic_calendar_terms_year_active
        ON core.saas_academic_calendar_terms (academic_year, is_active)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.tenant_school_calendar_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
            academic_year INT NOT NULL,
            event_type VARCHAR(32) NOT NULL,
            title VARCHAR(160) NOT NULL,
            term_code VARCHAR(80),
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            notes VARCHAR(500),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_tenant_school_calendar_events_type
                CHECK (event_type IN ('HALF_TERM_BREAK', 'EXAM_WINDOW'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_tenant_school_calendar_events_scope
        ON core.tenant_school_calendar_events (tenant_id, academic_year, event_type, is_active)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.ix_tenant_school_calendar_events_scope")
    op.execute("DROP TABLE IF EXISTS core.tenant_school_calendar_events")
