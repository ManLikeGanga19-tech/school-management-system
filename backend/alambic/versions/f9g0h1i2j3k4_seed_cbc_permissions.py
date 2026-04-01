"""seed CBC permissions and role grants

Revision ID: f9g0h1i2j3k4
Revises: e8f9g0h1i2j3
Create Date: 2026-03-29 10:10:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "f9g0h1i2j3k4"
down_revision: Union[str, None] = "e8f9g0h1i2j3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PERMISSIONS = [
    ("cbc.curriculum.manage", "Manage CBC curriculum structure", "CBC"),
    ("cbc.curriculum.view",   "View CBC curriculum structure",   "CBC"),
    ("cbc.assessments.enter", "Enter / update performance levels","CBC"),
    ("cbc.assessments.view",  "View learner CBC assessments",    "CBC"),
    ("cbc.reports.generate",  "Download learner CBC PDF report", "CBC"),
]

_ROLE_GRANTS: dict[str, list[str]] = {
    "DIRECTOR":  [
        "cbc.curriculum.manage",
        "cbc.curriculum.view",
        "cbc.assessments.enter",
        "cbc.assessments.view",
        "cbc.reports.generate",
    ],
    "SECRETARY": [
        "cbc.curriculum.view",
        "cbc.assessments.enter",
        "cbc.assessments.view",
        "cbc.reports.generate",
    ],
    "TEACHER": [
        "cbc.curriculum.view",
        "cbc.assessments.enter",
        "cbc.assessments.view",
    ],
    "PRINCIPAL": [
        "cbc.curriculum.view",
        "cbc.assessments.view",
        "cbc.reports.generate",
    ],
    "HEAD_TEACHER": [
        "cbc.curriculum.view",
        "cbc.assessments.view",
        "cbc.reports.generate",
    ],
}


def upgrade() -> None:
    for code, name, category in _PERMISSIONS:
        op.execute(
            f"""
            INSERT INTO core.permissions (code, name, category)
            VALUES ('{code}', '{name}', '{category}')
            ON CONFLICT (code) DO NOTHING
            """
        )

    for role_code, perm_codes in _ROLE_GRANTS.items():
        for perm_code in perm_codes:
            op.execute(
                f"""
                INSERT INTO core.role_permissions (role_id, permission_id)
                SELECT r.id, p.id
                FROM   core.roles r, core.permissions p
                WHERE  r.code = '{role_code}'
                AND    r.tenant_id IS NULL
                AND    p.code = '{perm_code}'
                ON CONFLICT DO NOTHING
                """
            )


def downgrade() -> None:
    for code, _, _ in _PERMISSIONS:
        op.execute(
            f"""
            DELETE FROM core.role_permissions
            WHERE permission_id = (SELECT id FROM core.permissions WHERE code = '{code}')
            """
        )
        op.execute(f"DELETE FROM core.permissions WHERE code = '{code}'")
