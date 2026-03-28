"""seed attendance permissions and assign to roles

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-03-27 09:20:00.000000

Permissions granted by role:

  Permission            Director  Secretary  Teacher
  ────────────────────────────────────────────────────
  attendance.view          ✓         ✓          ✓
  attendance.mark          ✓         ✓          ✓
  attendance.correct       ✓         ✓
  attendance.reports       ✓         ✓
  attendance.enroll        ✓         ✓
"""
from __future__ import annotations

from typing import Sequence, Union
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "k1l2m3n4o5p6"
down_revision: Union[str, None] = "j0k1l2m3n4o5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_PERMISSIONS = [
    ("attendance.view",    "View attendance records and sessions"),
    ("attendance.mark",    "Create sessions and record student attendance"),
    ("attendance.correct", "Correct attendance records on finalized sessions"),
    ("attendance.reports", "Access attendance summary and class reports"),
    ("attendance.enroll",  "Manage student class roster (enroll / withdraw)"),
]

_ROLE_GRANTS: dict[str, list[str]] = {
    "Director": [p[0] for p in _NEW_PERMISSIONS],
    "Secretary": [
        "attendance.view",
        "attendance.mark",
        "attendance.correct",
        "attendance.reports",
        "attendance.enroll",
    ],
    "Teacher": [
        "attendance.view",
        "attendance.mark",
    ],
}


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Upsert permissions
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

    # 2. Assign to roles across all tenants that have these system roles
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
                WHERE permission_id = (
                    SELECT id FROM core.permissions WHERE code = :code
                )
                """
            ),
            {"code": code},
        )
        conn.execute(
            sa.text("DELETE FROM core.permissions WHERE code = :code"),
            {"code": code},
        )
