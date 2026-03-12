"""merge head teacher into principal

Revision ID: h0i1j2k3l4m5
Revises: g9h0i1j2k3l4
Create Date: 2026-03-12 12:10:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "h0i1j2k3l4m5"
down_revision: Union[str, None] = "g9h0i1j2k3l4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


RETIRED_CODES = ("HEAD_TEACHER", "HEADTEACHER")


def upgrade() -> None:
    retired_in = ", ".join(f"'{code}'" for code in RETIRED_CODES)

    op.execute(
        f"""
        INSERT INTO core.roles (tenant_id, code, name, description, is_system)
        SELECT retired.tenant_id, 'PRINCIPAL', 'Principal', 'Academic lead for tenant school', true
        FROM core.roles retired
        WHERE retired.code IN ({retired_in})
          AND NOT EXISTS (
              SELECT 1
              FROM core.roles principal
              WHERE principal.code = 'PRINCIPAL'
                AND principal.tenant_id IS NOT DISTINCT FROM retired.tenant_id
          )
        """
    )

    op.execute(
        f"""
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT principal.id, rp.permission_id
        FROM core.roles retired
        JOIN core.roles principal
          ON principal.code = 'PRINCIPAL'
         AND principal.tenant_id IS NOT DISTINCT FROM retired.tenant_id
        JOIN core.role_permissions rp
          ON rp.role_id = retired.id
        WHERE retired.code IN ({retired_in})
        ON CONFLICT DO NOTHING
        """
    )

    op.execute(
        f"""
        INSERT INTO core.user_roles (id, tenant_id, user_id, role_id)
        SELECT gen_random_uuid(), ur.tenant_id, ur.user_id, principal.id
        FROM core.roles retired
        JOIN core.roles principal
          ON principal.code = 'PRINCIPAL'
         AND principal.tenant_id IS NOT DISTINCT FROM retired.tenant_id
        JOIN core.user_roles ur
          ON ur.role_id = retired.id
        WHERE retired.code IN ({retired_in})
        ON CONFLICT ON CONSTRAINT uq_user_roles_scope DO NOTHING
        """
    )

    op.execute(
        f"""
        DELETE FROM core.user_roles ur
        USING core.roles retired
        WHERE ur.role_id = retired.id
          AND retired.code IN ({retired_in})
        """
    )

    op.execute(
        f"""
        DELETE FROM core.role_permissions rp
        USING core.roles retired
        WHERE rp.role_id = retired.id
          AND retired.code IN ({retired_in})
        """
    )

    op.execute(
        f"""
        DELETE FROM core.roles
        WHERE code IN ({retired_in})
        """
    )

    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                first_value(id) OVER (
                    PARTITION BY COALESCE(tenant_id::text, '__global__'), code
                    ORDER BY created_at NULLS FIRST, id
                ) AS keep_id,
                row_number() OVER (
                    PARTITION BY COALESCE(tenant_id::text, '__global__'), code
                    ORDER BY created_at NULLS FIRST, id
                ) AS rn
            FROM core.roles
        ),
        dupes AS (
            SELECT id, keep_id
            FROM ranked
            WHERE rn > 1
        )
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT dupes.keep_id, rp.permission_id
        FROM dupes
        JOIN core.role_permissions rp ON rp.role_id = dupes.id
        ON CONFLICT DO NOTHING
        """
    )

    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                first_value(id) OVER (
                    PARTITION BY COALESCE(tenant_id::text, '__global__'), code
                    ORDER BY created_at NULLS FIRST, id
                ) AS keep_id,
                row_number() OVER (
                    PARTITION BY COALESCE(tenant_id::text, '__global__'), code
                    ORDER BY created_at NULLS FIRST, id
                ) AS rn
            FROM core.roles
        ),
        dupes AS (
            SELECT id, keep_id
            FROM ranked
            WHERE rn > 1
        )
        INSERT INTO core.user_roles (id, tenant_id, user_id, role_id)
        SELECT gen_random_uuid(), ur.tenant_id, ur.user_id, dupes.keep_id
        FROM dupes
        JOIN core.user_roles ur ON ur.role_id = dupes.id
        ON CONFLICT ON CONSTRAINT uq_user_roles_scope DO NOTHING
        """
    )

    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY COALESCE(tenant_id::text, '__global__'), code
                    ORDER BY created_at NULLS FIRST, id
                ) AS rn
            FROM core.roles
        )
        DELETE FROM core.roles r
        USING ranked
        WHERE r.id = ranked.id
          AND ranked.rn > 1
        """
    )

    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY COALESCE(tenant_id::text, '__global__'), user_id::text, role_id::text
                    ORDER BY created_at NULLS FIRST, id
                ) AS rn
            FROM core.user_roles
        )
        DELETE FROM core.user_roles ur
        USING ranked
        WHERE ur.id = ranked.id
          AND ranked.rn > 1
        """
    )

    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY COALESCE(tenant_id::text, '__global__'), user_id::text, permission_id::text
                    ORDER BY created_at NULLS FIRST, id
                ) AS rn
            FROM core.user_permission_overrides
        )
        DELETE FROM core.user_permission_overrides upo
        USING ranked
        WHERE upo.id = ranked.id
          AND ranked.rn > 1
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_roles_global_code
        ON core.roles (code)
        WHERE tenant_id IS NULL
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_user_roles_global_scope
        ON core.user_roles (user_id, role_id)
        WHERE tenant_id IS NULL
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_user_permission_overrides_global_scope
        ON core.user_permission_overrides (user_id, permission_id)
        WHERE tenant_id IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.ux_user_permission_overrides_global_scope")
    op.execute("DROP INDEX IF EXISTS core.ux_user_roles_global_scope")
    op.execute("DROP INDEX IF EXISTS core.ux_roles_global_code")

    op.execute(
        """
        INSERT INTO core.roles (tenant_id, code, name, description, is_system)
        SELECT principal.tenant_id, 'HEAD_TEACHER', 'Head Teacher', 'Academic lead for tenant school', true
        FROM core.roles principal
        WHERE principal.code = 'PRINCIPAL'
          AND NOT EXISTS (
              SELECT 1
              FROM core.roles retired
              WHERE retired.code = 'HEAD_TEACHER'
                AND retired.tenant_id IS NOT DISTINCT FROM principal.tenant_id
          )
        """
    )

    op.execute(
        """
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT retired.id, rp.permission_id
        FROM core.roles principal
        JOIN core.roles retired
          ON retired.code = 'HEAD_TEACHER'
         AND retired.tenant_id IS NOT DISTINCT FROM principal.tenant_id
        JOIN core.role_permissions rp
          ON rp.role_id = principal.id
        WHERE principal.code = 'PRINCIPAL'
        ON CONFLICT DO NOTHING
        """
    )

    op.execute(
        """
        INSERT INTO core.user_roles (id, tenant_id, user_id, role_id)
        SELECT gen_random_uuid(), ur.tenant_id, ur.user_id, retired.id
        FROM core.roles principal
        JOIN core.roles retired
          ON retired.code = 'HEAD_TEACHER'
         AND retired.tenant_id IS NOT DISTINCT FROM principal.tenant_id
        JOIN core.user_roles ur
          ON ur.role_id = principal.id
        WHERE principal.code = 'PRINCIPAL'
        ON CONFLICT ON CONSTRAINT uq_user_roles_scope DO NOTHING
        """
    )
