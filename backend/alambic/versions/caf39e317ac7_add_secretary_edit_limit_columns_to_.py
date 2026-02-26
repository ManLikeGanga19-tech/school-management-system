"""add secretary edit limit columns to enrollments

Revision ID: caf39e317ac7
Revises: 3479558deae5
Create Date: 2026-02-25 04:39:37.425878

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'caf39e317ac7'
down_revision: Union[str, None] = '3479558deae5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Change this if your enrollments table lives in a non-public schema
SCHEMA = "core"
TABLE  = "enrollments"


def upgrade() -> None:
    op.add_column(
        TABLE,
        sa.Column(
            "secretary_edit_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        schema=SCHEMA,
    )
    op.add_column(
        TABLE,
        sa.Column(
            "secretary_edit_locked",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column(TABLE, "secretary_edit_locked", schema=SCHEMA)
    op.drop_column(TABLE, "secretary_edit_count",  schema=SCHEMA)