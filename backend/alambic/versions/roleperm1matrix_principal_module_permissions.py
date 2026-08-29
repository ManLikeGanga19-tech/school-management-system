"""Complete the PRINCIPAL role permission matrix (academic lead).

The sidebar is being gated by RBAC permissions, so every role must actually hold
the view permissions for the modules it is meant to see. PRINCIPAL previously
held only a handful of permissions, which is too few for an academic lead
(exams/report cards, CBC, discipline, students, attendance, staff oversight).

This grants PRINCIPAL (and its HEAD_TEACHER alias) the academic module view/enter
permissions — but deliberately NOT finance management, RBAC, audit, users, or
payroll (those stay director-only). Global roles (tenant_id IS NULL) are shared
by every tenant, so this applies to all current and future tenants. Idempotent.

Revision ID: roleperm1matrix
Revises: calsync1follow
"""
from alembic import op

revision = "roleperm1matrix"
down_revision = "calsync1follow"
branch_labels = None
depends_on = None

PRINCIPAL_PERMS = (
    "admin.dashboard.view_tenant",
    "students.biodata.read",
    "students.emergency_contacts.read",
    "students.documents.read",
    "enrollment.manage",
    "attendance.view",
    "attendance.mark",
    "attendance.reports",
    "cbc.assessments.view",
    "cbc.assessments.enter",
    "cbc.curriculum.view",
    "cbc.reports.generate",
    "reports.view",
    "reports.edit",
    "reports.publish",
    "discipline.incidents.view",
    "discipline.incidents.manage",
    "hr.staff.view",
    "hr.leave.view",
    "finance.payments.view",
)


def upgrade() -> None:
    codes = ", ".join(f"'{c}'" for c in PRINCIPAL_PERMS)
    op.execute(
        f"""
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM core.roles r
        JOIN core.permissions p ON p.code IN ({codes})
        WHERE r.tenant_id IS NULL AND r.code IN ('PRINCIPAL', 'HEAD_TEACHER')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    codes = ", ".join(f"'{c}'" for c in PRINCIPAL_PERMS)
    op.execute(
        f"""
        DELETE FROM core.role_permissions rp
        USING core.roles r, core.permissions p
        WHERE rp.role_id = r.id AND rp.permission_id = p.id
          AND r.tenant_id IS NULL AND r.code IN ('PRINCIPAL', 'HEAD_TEACHER')
          AND p.code IN ({codes})
          AND p.code NOT IN ('admin.dashboard.view_tenant', 'enrollment.manage',
                             'cbc.assessments.view', 'cbc.curriculum.view',
                             'cbc.reports.generate', 'finance.payments.view')
        """
    )
