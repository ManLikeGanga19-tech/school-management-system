"""add soft delete to tenants

Revision ID: 677ab8f8f0e3
Revises: b3bd9ddce673
Create Date: 2026-02-12 14:42:32.871862

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '677ab8f8f0e3'
down_revision: Union[str, None] = 'b3bd9ddce673'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    op.add_column(
        "tenants",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        schema="core",
    )


def downgrade():
    op.drop_column("tenants", "deleted_at", schema="core")
