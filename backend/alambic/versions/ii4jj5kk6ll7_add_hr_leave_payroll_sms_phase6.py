"""Phase 6: HR leave/payroll tables, HR permissions, SMS default template seeding

Revision ID: ii4jj5kk6ll7
Revises: hh3ii4jj5kk6
Create Date: 2026-04-10 12:00:00.000000
"""
from __future__ import annotations
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ii4jj5kk6ll7"
down_revision: Union[str, None] = "hh3ii4jj5kk6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ── HR permissions ─────────────────────────────────────────────────────────────
_HR_PERMISSIONS = [
    ("hr.staff.view",          "HR",      "View staff directory"),
    ("hr.staff.manage",        "HR",      "Create and edit staff profiles"),
    ("hr.leave.view",          "HR",      "View leave requests"),
    ("hr.leave.approve",       "HR",      "Approve or reject leave requests"),
    ("hr.payroll.view",        "HR",      "View payslips and salary info"),
    ("hr.payroll.manage",      "HR",      "Generate payslips and manage salary structures"),
]

_ROLE_GRANTS: dict[str, list[str]] = {
    "Director": [
        "hr.staff.view", "hr.staff.manage",
        "hr.leave.view", "hr.leave.approve",
        "hr.payroll.view", "hr.payroll.manage",
    ],
    "Secretary": ["hr.staff.view", "hr.leave.view"],
}

# ── Default SMS templates (seeded per tenant) ──────────────────────────────────
_DEFAULT_SMS_TEMPLATES = [
    (
        "Fee Reminder",
        "Dear {parent_name}, this is a reminder that {student_name}'s school fees of KES {amount} are due on {due_date}. Please pay promptly to avoid inconvenience. Thank you.",
        ["parent_name", "student_name", "amount", "due_date"],
    ),
    (
        "Attendance Alert",
        "Dear {parent_name}, {student_name} was absent from school today ({date}). Please contact the school office if you need to report this absence.",
        ["parent_name", "student_name", "date"],
    ),
    (
        "Report Card Ready",
        "Dear {parent_name}, {student_name}'s report card for {term} is now ready for collection at the school office. Kindly visit during working hours.",
        ["parent_name", "student_name", "term"],
    ),
    (
        "Event Notification",
        "Dear {parent_name}, {school_name} wishes to inform you about an upcoming event: {event_name} on {date} at {time}. We look forward to your participation.",
        ["parent_name", "school_name", "event_name", "date", "time"],
    ),
    (
        "School Closure",
        "Dear Parent, please note that {school_name} will be closed on {date} due to {reason}. Normal operations resume on {resume_date}.",
        ["school_name", "date", "reason", "resume_date"],
    ),
    (
        "Parents Meeting",
        "Dear {parent_name}, you are cordially invited to a parents' meeting on {date} at {time} in {venue}. Your attendance is highly encouraged.",
        ["parent_name", "date", "time", "venue"],
    ),
]


def upgrade() -> None:
    # ── staff_leave_requests ────────────────────────────────────────────────────
    op.create_table(
        "staff_leave_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("staff_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.staff_directory.id", ondelete="CASCADE"), nullable=False),
        sa.Column("leave_type", sa.String(50), nullable=False),   # ANNUAL | SICK | MATERNITY | PATERNITY | UNPAID | OTHER
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("days_requested", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'PENDING'")),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint(
            "status IN ('PENDING','APPROVED','REJECTED','CANCELLED')",
            name="ck_staff_leave_requests_status",
        ),
        sa.CheckConstraint(
            "leave_type IN ('ANNUAL','SICK','MATERNITY','PATERNITY','UNPAID','OTHER')",
            name="ck_staff_leave_requests_leave_type",
        ),
        sa.CheckConstraint("end_date >= start_date", name="ck_staff_leave_dates"),
        sa.CheckConstraint("days_requested > 0", name="ck_staff_leave_days_positive"),
        schema="core",
    )
    op.create_index("ix_staff_leave_requests_tenant_staff",
                    "staff_leave_requests", ["tenant_id", "staff_id"], schema="core")
    op.create_index("ix_staff_leave_requests_tenant_status",
                    "staff_leave_requests", ["tenant_id", "status"], schema="core")

    # ── staff_salary_structures ─────────────────────────────────────────────────
    op.create_table(
        "staff_salary_structures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("staff_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.staff_directory.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("basic_salary", sa.Numeric(12, 2), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("house_allowance", sa.Numeric(12, 2), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("transport_allowance", sa.Numeric(12, 2), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("other_allowances", sa.Numeric(12, 2), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("helb_deduction", sa.Numeric(12, 2), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("loan_deduction", sa.Numeric(12, 2), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema="core",
    )
    op.create_index("ix_staff_salary_structures_tenant",
                    "staff_salary_structures", ["tenant_id"], schema="core")

    # ── staff_payslips ──────────────────────────────────────────────────────────
    op.create_table(
        "staff_payslips",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("staff_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.staff_directory.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pay_month", sa.SmallInteger(), nullable=False),   # 1-12
        sa.Column("pay_year", sa.SmallInteger(), nullable=False),
        # Gross
        sa.Column("basic_salary", sa.Numeric(12, 2), nullable=False),
        sa.Column("house_allowance", sa.Numeric(12, 2), nullable=False),
        sa.Column("transport_allowance", sa.Numeric(12, 2), nullable=False),
        sa.Column("other_allowances", sa.Numeric(12, 2), nullable=False),
        sa.Column("gross_pay", sa.Numeric(12, 2), nullable=False),
        # Statutory deductions (Kenya)
        sa.Column("paye", sa.Numeric(12, 2), nullable=False),
        sa.Column("nhif", sa.Numeric(12, 2), nullable=False),
        sa.Column("nssf_employee", sa.Numeric(12, 2), nullable=False),
        sa.Column("nssf_employer", sa.Numeric(12, 2), nullable=False),
        # Other deductions
        sa.Column("helb_deduction", sa.Numeric(12, 2), nullable=False),
        sa.Column("loan_deduction", sa.Numeric(12, 2), nullable=False),
        sa.Column("total_deductions", sa.Numeric(12, 2), nullable=False),
        sa.Column("net_pay", sa.Numeric(12, 2), nullable=False),
        sa.Column("generated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "staff_id", "pay_month", "pay_year",
                            name="uq_staff_payslips_staff_month_year"),
        schema="core",
    )
    op.create_index("ix_staff_payslips_tenant_year_month",
                    "staff_payslips", ["tenant_id", "pay_year", "pay_month"], schema="core")
    op.create_index("ix_staff_payslips_staff",
                    "staff_payslips", ["staff_id"], schema="core")

    # ── HR permissions ──────────────────────────────────────────────────────────
    for code, category, description in _HR_PERMISSIONS:
        op.execute(f"""
            INSERT INTO core.permissions (code, name, description, category)
            VALUES ('{code}', '{description}', '{description}', '{category}')
            ON CONFLICT (code) DO NOTHING
        """)

    for role_name, perms in _ROLE_GRANTS.items():
        for perm_code in perms:
            op.execute(f"""
                INSERT INTO core.role_permissions (role_id, permission_id)
                SELECT r.id, p.id
                FROM   core.roles r
                JOIN   core.permissions p ON p.code = '{perm_code}'
                WHERE  r.name = '{role_name}'
                  AND  NOT EXISTS (
                      SELECT 1 FROM core.role_permissions rp2
                      WHERE  rp2.role_id = r.id AND rp2.permission_id = p.id
                  )
            """)

    # ── Seed default SMS templates for all existing tenants ────────────────────
    for name, body, variables in _DEFAULT_SMS_TEMPLATES:
        import json as _json
        vars_json = _json.dumps(variables)
        op.execute(f"""
            INSERT INTO core.sms_templates (tenant_id, name, body, variables)
            SELECT t.id, '{name}', $tpl${body}$tpl$, $vars${vars_json}$vars$::jsonb
            FROM   core.tenants t
            WHERE  NOT EXISTS (
                SELECT 1 FROM core.sms_templates st
                WHERE  st.tenant_id = t.id AND st.name = '{name}'
            )
        """)


def downgrade() -> None:
    op.drop_index("ix_staff_payslips_staff", table_name="staff_payslips", schema="core")
    op.drop_index("ix_staff_payslips_tenant_year_month", table_name="staff_payslips", schema="core")
    op.drop_table("staff_payslips", schema="core")

    op.drop_index("ix_staff_salary_structures_tenant", table_name="staff_salary_structures", schema="core")
    op.drop_table("staff_salary_structures", schema="core")

    op.drop_index("ix_staff_leave_requests_tenant_status", table_name="staff_leave_requests", schema="core")
    op.drop_index("ix_staff_leave_requests_tenant_staff", table_name="staff_leave_requests", schema="core")
    op.drop_table("staff_leave_requests", schema="core")

    codes = [code for code, _, _ in _HR_PERMISSIONS]
    codes_sql = ", ".join(f"'{c}'" for c in codes)
    op.execute(f"""
        DELETE FROM core.role_permissions
        WHERE permission_id IN (
            SELECT id FROM core.permissions WHERE code IN ({codes_sql})
        )
    """)
    op.execute(f"DELETE FROM core.permissions WHERE code IN ({codes_sql})")
