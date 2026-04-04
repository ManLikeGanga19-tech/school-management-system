"""Add discipline module tables and permissions

Revision ID: ff1gg2hh3ii4
Revises: ee1ff2gg3hh4
Create Date: 2026-04-04 12:00:00.000000

  Permission                   Director  Secretary  Teacher
  ──────────────────────────────────────────────────────────
  discipline.incidents.view       ✓         ✓          ✓
  discipline.incidents.manage     ✓         ✓
  discipline.incidents.resolve    ✓
  students.hard_delete            ✓
"""
from __future__ import annotations

from typing import Sequence, Union
from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ff1gg2hh3ii4"
down_revision: Union[str, tuple] = "ee1ff2gg3hh4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_PERMISSIONS = [
    ("discipline.incidents.view",    "View discipline incidents"),
    ("discipline.incidents.manage",  "Create and edit discipline incidents"),
    ("discipline.incidents.resolve", "Resolve and close discipline incidents"),
    ("students.hard_delete",         "Permanently delete a student and all their records"),
]

_ROLE_GRANTS: dict[str, list[str]] = {
    "Director":  [
        "discipline.incidents.view",
        "discipline.incidents.manage",
        "discipline.incidents.resolve",
        "students.hard_delete",
    ],
    "Secretary": [
        "discipline.incidents.view",
        "discipline.incidents.manage",
    ],
    "Teacher": [
        "discipline.incidents.view",
    ],
}


def upgrade() -> None:
    # ── Tables ────────────────────────────────────────────────────────────────

    op.create_table(
        "discipline_incidents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("incident_date", sa.Date(), nullable=False),
        sa.Column("incident_type", sa.String(80), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default=sa.text("'LOW'")),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("reported_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default=sa.text("'OPEN'")),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        schema="core",
    )

    op.create_table(
        "discipline_students",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("enrollment_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role", sa.String(30), nullable=False, server_default=sa.text("'PERPETRATOR'")),
        sa.Column("action_taken", sa.String(50), nullable=True),
        sa.Column("action_notes", sa.Text(), nullable=True),
        sa.Column("parent_notified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("parent_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["incident_id"], ["core.discipline_incidents.id"],
            name="fk_discipline_students_incident",
            ondelete="CASCADE",
        ),
        schema="core",
    )

    op.create_table(
        "discipline_followups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("followup_date", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["incident_id"], ["core.discipline_incidents.id"],
            name="fk_discipline_followups_incident",
            ondelete="CASCADE",
        ),
        schema="core",
    )

    # ── Indexes ───────────────────────────────────────────────────────────────

    op.create_index(
        "ix_discipline_incidents_tenant",
        "discipline_incidents", ["tenant_id"], schema="core",
    )
    op.create_index(
        "ix_discipline_incidents_date",
        "discipline_incidents", ["tenant_id", "incident_date"], schema="core",
    )
    op.create_index(
        "ix_discipline_incidents_status",
        "discipline_incidents", ["tenant_id", "status"], schema="core",
    )
    op.create_index(
        "ix_discipline_students_incident",
        "discipline_students", ["incident_id"], schema="core",
    )
    op.create_index(
        "ix_discipline_students_student",
        "discipline_students", ["tenant_id", "student_id"], schema="core",
    )
    op.create_index(
        "ix_discipline_followups_incident",
        "discipline_followups", ["incident_id"], schema="core",
    )

    # ── Permissions ───────────────────────────────────────────────────────────

    conn = op.get_bind()

    for code, name in _NEW_PERMISSIONS:
        existing = conn.execute(
            sa.text("SELECT id FROM core.permissions WHERE code = :code"),
            {"code": code},
        ).fetchone()
        if not existing:
            conn.execute(
                sa.text(
                    "INSERT INTO core.permissions (id, code, name) "
                    "VALUES (:id, :code, :name)"
                ),
                {"id": str(uuid4()), "code": code, "name": name},
            )

    for role_name, perm_codes in _ROLE_GRANTS.items():
        for perm_code in perm_codes:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO core.role_permissions (role_id, permission_id)
                    SELECT r.id, p.id
                    FROM core.roles r
                    JOIN core.permissions p ON p.code = :perm_code
                    WHERE r.name = :role_name
                    ON CONFLICT DO NOTHING
                    """
                ),
                {"role_name": role_name, "perm_code": perm_code},
            )


def downgrade() -> None:
    conn = op.get_bind()

    # Remove permissions
    codes = [p[0] for p in _NEW_PERMISSIONS]
    for code in codes:
        conn.execute(
            sa.text(
                """
                DELETE FROM core.role_permissions
                WHERE permission_id = (SELECT id FROM core.permissions WHERE code = :code)
                """
            ),
            {"code": code},
        )
        conn.execute(
            sa.text("DELETE FROM core.permissions WHERE code = :code"),
            {"code": code},
        )

    # Drop tables (CASCADE handles child tables)
    op.drop_table("discipline_followups", schema="core")
    op.drop_table("discipline_students", schema="core")
    op.drop_table("discipline_incidents", schema="core")
