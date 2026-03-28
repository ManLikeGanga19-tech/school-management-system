"""seed report card permissions and assign to roles

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-03-27 10:10:00.000000

  Permission               Director  Secretary  Teacher
  ─────────────────────────────────────────────────────
  reports.view                ✓         ✓          ✓
  reports.edit                ✓         ✓
  reports.publish             ✓
"""
from __future__ import annotations

from typing import Sequence, Union
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "m3n4o5p6q7r8"
down_revision: Union[str, None] = "l2m3n4o5p6q7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_PERMISSIONS = [
    ("reports.view",    "View term report cards and class results"),
    ("reports.edit",    "Edit class-teacher / principal remarks on report cards"),
    ("reports.publish", "Publish report cards (makes them visible to parents)"),
]

_ROLE_GRANTS: dict[str, list[str]] = {
    "Director":  ["reports.view", "reports.edit", "reports.publish"],
    "Secretary": ["reports.view", "reports.edit"],
    "Teacher":   ["reports.view"],
}


def upgrade() -> None:
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
