"""add finance.payments.view permission and assign to roles

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-24 10:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6g7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Create the missing finance.payments.view permission
    op.execute(
        "INSERT INTO core.permissions (code, name) "
        "VALUES ('finance.payments.view', 'View payment records') "
        "ON CONFLICT (code) DO NOTHING"
    )

    # 2) Grant it to all roles that should be able to view payments:
    #    SUPER_ADMIN, DIRECTOR, SECRETARY, PRINCIPAL
    op.execute("""
    INSERT INTO core.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM core.roles r
    JOIN core.permissions p ON p.code = 'finance.payments.view'
    WHERE r.code IN ('SUPER_ADMIN', 'DIRECTOR', 'SECRETARY', 'PRINCIPAL')
    ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute(
        "DELETE FROM core.role_permissions "
        "WHERE permission_id = (SELECT id FROM core.permissions WHERE code = 'finance.payments.view')"
    )
    op.execute("DELETE FROM core.permissions WHERE code = 'finance.payments.view'")
