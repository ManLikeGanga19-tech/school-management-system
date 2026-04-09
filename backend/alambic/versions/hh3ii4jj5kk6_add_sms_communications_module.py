"""Add SMS communications module (Phase 5)

Revision ID: hh3ii4jj5kk6
Revises: gg2hh3ii4jj5
Create Date: 2026-04-10 09:00:00.000000

Tables created:
  core.sms_pricing           — platform-wide per-unit price (SaaS admin)
  core.sms_credit_accounts   — per-tenant SMS credit balance
  core.sms_credit_topups     — M-Pesa top-up purchase history
  core.sms_messages          — every outbound SMS log
  core.sms_templates         — reusable message templates per tenant

Permissions seeded:
  sms.credits.view           Director, Secretary
  sms.credits.topup          Director
  sms.send                   Director, Secretary
  sms.templates.manage       Director, Secretary
  admin.sms.manage           (SaaS admin only — granted via require_permission_saas)
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "hh3ii4jj5kk6"
down_revision: Union[str, tuple] = "gg2hh3ii4jj5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_PERMISSIONS = [
    ("sms.credits.view",      "View SMS credit balance and top-up history"),
    ("sms.credits.topup",     "Purchase SMS credits via M-Pesa"),
    ("sms.send",              "Send SMS messages to parents/guardians"),
    ("sms.templates.manage",  "Create, edit and delete SMS message templates"),
]

_ROLE_GRANTS: dict[str, list[str]] = {
    "Director": [
        "sms.credits.view",
        "sms.credits.topup",
        "sms.send",
        "sms.templates.manage",
    ],
    "Secretary": [
        "sms.credits.view",
        "sms.send",
        "sms.templates.manage",
    ],
}


def upgrade() -> None:
    # ── sms_pricing ───────────────────────────────────────────────────────────
    # Single-row table managed by the SaaS admin.  New price takes effect
    # immediately for all subsequent top-ups.
    op.create_table(
        "sms_pricing",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("price_per_unit_kes", sa.Numeric(10, 4), nullable=False,
                  server_default=sa.text("1.50")),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        schema="core",
    )

    # ── sms_credit_accounts ───────────────────────────────────────────────────
    op.create_table(
        "sms_credit_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("balance_units", sa.Integer(), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        schema="core",
    )

    # ── sms_credit_topups ─────────────────────────────────────────────────────
    op.create_table(
        "sms_credit_topups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("units_requested", sa.Integer(), nullable=False),
        sa.Column("amount_kes", sa.Numeric(12, 2), nullable=False),
        sa.Column("price_per_unit_snapshot", sa.Numeric(10, 4), nullable=False),
        sa.Column("phone_number", sa.String(20), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False,
                  server_default=sa.text("'MPESA_DARAJA'")),
        sa.Column("checkout_request_id", sa.String(120), nullable=True, unique=True),
        sa.Column("merchant_request_id", sa.String(120), nullable=True),
        sa.Column("mpesa_receipt", sa.String(120), nullable=True),
        sa.Column("status", sa.String(16), nullable=False,
                  server_default=sa.text("'PENDING'")),
        sa.Column("result_code", sa.Integer(), nullable=True),
        sa.Column("result_desc", sa.Text(), nullable=True),
        sa.Column("request_payload", postgresql.JSONB(), nullable=True),
        sa.Column("callback_payload", postgresql.JSONB(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('PENDING','COMPLETED','FAILED','CANCELLED')",
            name="ck_sms_credit_topups_status",
        ),
        schema="core",
    )
    op.create_index(
        "ix_sms_credit_topups_tenant_created",
        "sms_credit_topups",
        ["tenant_id", "created_at"],
        schema="core",
    )
    op.create_index(
        "ix_sms_credit_topups_checkout",
        "sms_credit_topups",
        ["checkout_request_id"],
        schema="core",
    )

    # ── sms_messages ──────────────────────────────────────────────────────────
    op.create_table(
        "sms_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("to_phone", sa.String(20), nullable=False),
        sa.Column("recipient_name", sa.String(200), nullable=True),
        sa.Column("message_body", sa.Text(), nullable=False),
        sa.Column("units_deducted", sa.Integer(), nullable=False,
                  server_default=sa.text("1")),
        sa.Column("status", sa.String(16), nullable=False,
                  server_default=sa.text("'QUEUED'")),
        sa.Column("provider_message_id", sa.String(120), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("meta", postgresql.JSONB(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('QUEUED','SENT','DELIVERED','FAILED')",
            name="ck_sms_messages_status",
        ),
        schema="core",
    )
    op.create_index(
        "ix_sms_messages_tenant_created",
        "sms_messages",
        ["tenant_id", "created_at"],
        schema="core",
    )

    # ── sms_templates ─────────────────────────────────────────────────────────
    op.create_table(
        "sms_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("variables", postgresql.JSONB(), nullable=True,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "name", name="uq_sms_templates_tenant_name"),
        schema="core",
    )

    # ── Seed initial pricing row ──────────────────────────────────────────────
    op.execute(
        "INSERT INTO core.sms_pricing (price_per_unit_kes) VALUES (1.50)"
    )

    # ── Seed permissions ──────────────────────────────────────────────────────
    for code, description in _NEW_PERMISSIONS:
        op.execute(f"""
            INSERT INTO core.permissions (code, name, description)
            VALUES ('{code}', '{description}', '{description}')
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


def downgrade() -> None:
    op.drop_index("ix_sms_messages_tenant_created",
                  table_name="sms_messages", schema="core")
    op.drop_index("ix_sms_credit_topups_checkout",
                  table_name="sms_credit_topups", schema="core")
    op.drop_index("ix_sms_credit_topups_tenant_created",
                  table_name="sms_credit_topups", schema="core")
    op.drop_table("sms_templates", schema="core")
    op.drop_table("sms_messages", schema="core")
    op.drop_table("sms_credit_topups", schema="core")
    op.drop_table("sms_credit_accounts", schema="core")
    op.drop_table("sms_pricing", schema="core")

    codes = [code for code, _ in _NEW_PERMISSIONS]
    codes_sql = ", ".join(f"'{c}'" for c in codes)
    op.execute(f"""
        DELETE FROM core.role_permissions
        WHERE permission_id IN (
            SELECT id FROM core.permissions WHERE code IN ({codes_sql})
        )
    """)
    op.execute(f"DELETE FROM core.permissions WHERE code IN ({codes_sql})")
