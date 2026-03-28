"""seed SIS permissions and assign to roles

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-03-27 08:50:00.000000

Adds the 6 SIS permissions and assigns them to Director, Secretary,
and Teacher roles according to the access matrix below:

  Permission                         Director  Secretary  Teacher
  ─────────────────────────────────────────────────────────────────
  students.biodata.read              ✓         ✓          ✓ (own class)
  students.biodata.update            ✓         ✓
  students.emergency_contacts.read   ✓         ✓          ✓
  students.emergency_contacts.manage ✓         ✓
  students.documents.read            ✓         ✓
  students.documents.manage          ✓         ✓
"""
from __future__ import annotations

from typing import Sequence, Union
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "h8i9j0k1l2m3"
down_revision: Union[str, None] = "g7h8i9j0k1l2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_PERMISSIONS = [
    ("students.biodata.read",              "Read extended student bio-data"),
    ("students.biodata.update",            "Update extended student bio-data"),
    ("students.emergency_contacts.read",   "Read student emergency contacts"),
    ("students.emergency_contacts.manage", "Create / update / delete emergency contacts"),
    ("students.documents.read",            "Read student documents"),
    ("students.documents.manage",          "Upload / delete student documents"),
]

# role_name → list of permission codes granted to that role
_ROLE_GRANTS: dict[str, list[str]] = {
    "Director": [p[0] for p in _NEW_PERMISSIONS],
    "Secretary": [
        "students.biodata.read",
        "students.biodata.update",
        "students.emergency_contacts.read",
        "students.emergency_contacts.manage",
        "students.documents.read",
        "students.documents.manage",
    ],
    "Teacher": [
        "students.biodata.read",
        "students.emergency_contacts.read",
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

    # 2. Assign to roles (all tenants that have these system roles)
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
