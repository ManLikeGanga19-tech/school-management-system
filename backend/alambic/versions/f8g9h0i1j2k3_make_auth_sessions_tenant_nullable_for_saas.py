"""make auth_sessions.tenant_id nullable for SaaS sessions

Revision ID: f8g9h0i1j2k3
Revises: e7f8g9h0i1j2
Create Date: 2026-03-07 08:35:00.000000
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "f8g9h0i1j2k3"
down_revision: Union[str, None] = "e7f8g9h0i1j2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "auth_sessions",
        "tenant_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
        schema="core",
    )


def downgrade() -> None:
    op.alter_column(
        "auth_sessions",
        "tenant_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
        schema="core",
    )
