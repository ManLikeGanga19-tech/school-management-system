"""seed principal and head teacher role permission matrix

Revision ID: z3a4b5c6d7e8
Revises: y2z3a4b5c6d7
Create Date: 2026-03-03 11:10:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "z3a4b5c6d7e8"
down_revision: Union[str, None] = "y2z3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Ensure baseline permission exists in older environments.
    op.execute(
        """
        INSERT INTO core.permissions (code, name)
        VALUES ('enrollment.manage', 'Manage enrollment')
        ON CONFLICT (code) DO NOTHING
        """
    )

    # Seed global principal roles used by tenant schools.
    op.execute(
        """
        INSERT INTO core.roles (tenant_id, code, name, description, is_system)
        VALUES
            (NULL, 'PRINCIPAL', 'Principal', 'Academic lead for tenant school', true),
            (NULL, 'HEAD_TEACHER', 'Head Teacher', 'Academic lead for tenant school', true)
        ON CONFLICT ON CONSTRAINT uq_roles_tenant_code
        DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            is_system = true
        """
    )

    # Explicit and locked matrix:
    # Principal/Head Teacher can operate academic workflows (exam/event/timetable/student)
    # via enrollment.manage, but cannot manage tenant users/RBAC/finance policy by default.
    op.execute(
        """
        DELETE FROM core.role_permissions rp
        USING core.roles r, core.permissions p
        WHERE rp.role_id = r.id
          AND rp.permission_id = p.id
          AND r.tenant_id IS NULL
          AND r.code IN ('PRINCIPAL', 'HEAD_TEACHER')
          AND p.code NOT IN ('enrollment.manage')
        """
    )

    op.execute(
        """
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM core.roles r
        JOIN core.permissions p ON p.code IN ('enrollment.manage')
        WHERE r.tenant_id IS NULL
          AND r.code IN ('PRINCIPAL', 'HEAD_TEACHER')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM core.role_permissions
        WHERE role_id IN (
            SELECT id
            FROM core.roles
            WHERE tenant_id IS NULL
              AND code IN ('PRINCIPAL', 'HEAD_TEACHER')
        )
        """
    )

    op.execute(
        """
        DELETE FROM core.roles
        WHERE tenant_id IS NULL
          AND code IN ('PRINCIPAL', 'HEAD_TEACHER')
        """
    )
