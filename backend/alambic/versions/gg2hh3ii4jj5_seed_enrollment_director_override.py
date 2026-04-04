"""seed enrollment.director.override permission and grant to Director role

Revision ID: gg2hh3ii4jj5
Revises: ff1gg2hh3ii4
Create Date: 2026-04-04

"""
from alembic import op

revision = "gg2hh3ii4jj5"
down_revision = "ff1gg2hh3ii4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO core.permissions (code, name, description)
        VALUES ('enrollment.director.override', 'Director enrollment override', 'Director-level override for enrollment operations (status changes, bulk actions)')
        ON CONFLICT (code) DO NOTHING;
        """
    )

    op.execute(
        """
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM core.roles r
        JOIN core.permissions p ON p.code = 'enrollment.director.override'
        WHERE r.name = 'Director'
          AND NOT EXISTS (
              SELECT 1 FROM core.role_permissions rp2
              WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
          );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM core.role_permissions
        WHERE permission_id = (SELECT id FROM core.permissions WHERE code = 'enrollment.director.override');
        """
    )
    op.execute(
        "DELETE FROM core.permissions WHERE code = 'enrollment.director.override';"
    )
