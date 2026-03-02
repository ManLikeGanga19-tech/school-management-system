"""expand principal role permissions matrix

Revision ID: a4b5c6d7e8f9
Revises: z3a4b5c6d7e8
Create Date: 2026-03-03 16:25:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "a4b5c6d7e8f9"
down_revision: Union[str, None] = "z3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PRINCIPAL_PERMISSION_CODES = (
    "admin.dashboard.view_tenant",
    "enrollment.manage",
)


def upgrade() -> None:
    # Ensure required baseline permissions exist in older environments.
    op.execute(
        """
        INSERT INTO core.permissions (code, name)
        VALUES
            ('admin.dashboard.view_tenant', 'View tenant dashboard summary'),
            ('enrollment.manage', 'Manage enrollment')
        ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name
        """
    )

    # Ensure principal system roles exist globally.
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

    # Explicit and locked principal matrix for academic operations:
    # - Dashboard aggregate
    # - Students, exams, events, timetable, teachers, notifications
    # (mapped in tenant routes to admin.dashboard.view_tenant OR enrollment.manage)
    op.execute(
        f"""
        DELETE FROM core.role_permissions rp
        USING core.roles r, core.permissions p
        WHERE rp.role_id = r.id
          AND rp.permission_id = p.id
          AND r.tenant_id IS NULL
          AND r.code IN ('PRINCIPAL', 'HEAD_TEACHER')
          AND p.code NOT IN ({", ".join(f"'{code}'" for code in PRINCIPAL_PERMISSION_CODES)})
        """
    )

    op.execute(
        f"""
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM core.roles r
        JOIN core.permissions p
          ON p.code IN ({", ".join(f"'{code}'" for code in PRINCIPAL_PERMISSION_CODES)})
        WHERE r.tenant_id IS NULL
          AND r.code IN ('PRINCIPAL', 'HEAD_TEACHER')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    # Revert to previous principal matrix baseline (enrollment.manage only).
    op.execute(
        """
        DELETE FROM core.role_permissions rp
        USING core.roles r
        WHERE rp.role_id = r.id
          AND r.tenant_id IS NULL
          AND r.code IN ('PRINCIPAL', 'HEAD_TEACHER')
        """
    )

    op.execute(
        """
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM core.roles r
        JOIN core.permissions p ON p.code = 'enrollment.manage'
        WHERE r.tenant_id IS NULL
          AND r.code IN ('PRINCIPAL', 'HEAD_TEACHER')
        ON CONFLICT DO NOTHING
        """
    )
