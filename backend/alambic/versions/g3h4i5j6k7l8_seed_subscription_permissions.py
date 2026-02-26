"""seed subscription and updated permissions

Revision ID: g3h4i5j6k7l8
Revises: f2g3h4i5j6k7
Create Date: 2026-02-23 10:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g3h4i5j6k7l8'
down_revision: Union[str, None] = 'f2g3h4i5j6k7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add missing permissions
    new_perms = [
        ("subscriptions.read", "View subscriptions"),
        ("subscriptions.manage", "Manage subscriptions"),
    ]
    
    for code, name in new_perms:
        op.execute(f"""
        INSERT INTO core.permissions (code, name) VALUES ('{code}', '{name}')
        ON CONFLICT (code) DO NOTHING
        """)
    
    # Add subscription permissions to SUPER_ADMIN role
    op.execute("""
    INSERT INTO core.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM core.roles r, core.permissions p
    WHERE r.code = 'SUPER_ADMIN'
      AND p.code IN ('subscriptions.read', 'subscriptions.manage')
    ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    # Remove subscription permissions (they'll stay in the table but won't be assigned)
    op.execute("""
    DELETE FROM core.role_permissions
    WHERE permission_id IN (
        SELECT id FROM core.permissions WHERE code IN ('subscriptions.read', 'subscriptions.manage')
    )
    """)
    
    op.execute("""
    DELETE FROM core.permissions WHERE code IN ('subscriptions.read', 'subscriptions.manage')
    """)
