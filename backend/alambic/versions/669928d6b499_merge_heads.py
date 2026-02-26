"""merge heads

Revision ID: 669928d6b499
Revises: a9f3d1c7b8e1, g3h4i5j6k7l8
Create Date: 2026-02-23 11:18:43.619644

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '669928d6b499'
down_revision: Union[str, None] = ('a9f3d1c7b8e1', 'g3h4i5j6k7l8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
