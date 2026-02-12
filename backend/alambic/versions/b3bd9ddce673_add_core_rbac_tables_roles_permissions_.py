"""add core rbac tables(roles, permissions, overrides)

Revision ID: b3bd9ddce673
Revises: 6ac369d9e120
Create Date: 2026-02-12 14:23:48.434917

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b3bd9ddce673'
down_revision: Union[str, None] = '6ac369d9e120'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")

    # roles (tenant-scoped optional; NULL tenant_id = global role)
    op.create_table(
        "roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_roles_tenant_code"),
        schema="core",
    )

    # permissions (global catalog)
    op.create_table(
        "permissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(), nullable=False, unique=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        schema="core",
    )

    # role_permissions
    op.create_table(
        "role_permissions",
        sa.Column("role_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.roles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("permission_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.permissions.id", ondelete="CASCADE"), primary_key=True),
        schema="core",
    )

    # user_roles (tenant-scoped, but can be global via NULL tenant_id for SUPER_ADMIN)
    op.create_table(
        "user_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "user_id", "role_id", name="uq_user_roles_scope"),
        schema="core",
    )

    # user_permission_overrides (ALLOW/DENY)
    op.create_table(
        "user_permission_overrides",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.permissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("effect", sa.String(), nullable=False),  # "ALLOW" | "DENY"
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "user_id", "permission_id", name="uq_user_perm_override_scope"),
        schema="core",
    )

    # ---- Seed permissions (minimal but scalable) ----
    perms = [
        ("tenants.read_all", "View all tenants"),
        ("tenants.create", "Create tenant"),
        ("tenants.update", "Update tenant"),
        ("tenants.suspend", "Suspend tenant"),
        ("tenants.delete", "Delete tenant"),

        ("admin.dashboard.view_all", "View SaaS dashboard summary"),
        ("admin.dashboard.view_tenant", "View tenant dashboard summary"),

        ("rbac.roles.manage", "Manage roles"),
        ("rbac.permissions.manage", "Manage permissions"),
        ("rbac.user_roles.manage", "Assign roles to users"),
        ("rbac.user_permissions.manage", "Assign user permission overrides"),

        ("users.manage", "Manage users"),
        ("audit.read", "View audit logs"),

        ("enrollment.manage", "Manage enrollment"),
    ]

    op.execute("INSERT INTO core.permissions (code, name) VALUES " + ", ".join(
        [f"('{code}', '{name}')" for code, name in perms]
    ) + " ON CONFLICT (code) DO NOTHING")

    # ---- Seed system roles (global) ----
    roles = [
        ("SUPER_ADMIN", "Super Admin", "SaaS operator"),
        ("DIRECTOR", "Director", "Tenant admin (school director)"),
        ("SECRETARY", "Secretary", "Core ops + accounting tasks"),
        ("TEACHER", "Teacher", "Teaching staff"),
        ("PARENT", "Parent", "Parent/guardian"),
    ]

    op.execute("INSERT INTO core.roles (tenant_id, code, name, description, is_system) VALUES " + ", ".join(
        [f"(NULL, '{code}', '{name}', '{desc}', true)" for code, name, desc in roles]
    ) + " ON CONFLICT ON CONSTRAINT uq_roles_tenant_code DO NOTHING")

    # ---- Role permissions mapping (tight for now; expand later) ----
    # SUPER_ADMIN: all tenant-level + SaaS summary + audit across
    op.execute("""
    INSERT INTO core.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM core.roles r, core.permissions p
    WHERE r.code = 'SUPER_ADMIN'
      AND p.code IN (
        'tenants.read_all','tenants.create','tenants.update','tenants.suspend','tenants.delete',
        'admin.dashboard.view_all','audit.read',
        'rbac.roles.manage','rbac.permissions.manage','rbac.user_roles.manage','rbac.user_permissions.manage',
        'users.manage'
      )
    ON CONFLICT DO NOTHING
    """)

    # DIRECTOR: tenant dashboard + manage users/rbac within tenant + audit within tenant + enrollment manage
    op.execute("""
    INSERT INTO core.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM core.roles r, core.permissions p
    WHERE r.code = 'DIRECTOR'
      AND p.code IN (
        'admin.dashboard.view_tenant','users.manage','audit.read',
        'rbac.roles.manage','rbac.user_roles.manage','rbac.user_permissions.manage',
        'enrollment.manage'
      )
    ON CONFLICT DO NOTHING
    """)

    # SECRETARY: enrollment manage + tenant dashboard
    op.execute("""
    INSERT INTO core.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM core.roles r, core.permissions p
    WHERE r.code = 'SECRETARY'
      AND p.code IN ('admin.dashboard.view_tenant','enrollment.manage')
    ON CONFLICT DO NOTHING
    """)

    # TEACHER / PARENT: only tenant dashboard for now (we’ll expand later)
    op.execute("""
    INSERT INTO core.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM core.roles r, core.permissions p
    WHERE r.code IN ('TEACHER','PARENT')
      AND p.code IN ('admin.dashboard.view_tenant')
    ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.drop_table("user_permission_overrides", schema="core")
    op.drop_table("user_roles", schema="core")
    op.drop_table("role_permissions", schema="core")
    op.drop_table("permissions", schema="core")
    op.drop_table("roles", schema="core")
