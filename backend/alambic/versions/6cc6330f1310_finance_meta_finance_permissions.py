"""finance meta + finance permissions

Revision ID: 6cc6330f1310
Revises: 9d4740cc405f
Create Date: 2026-02-13 11:21:58.883156

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql 

# revision identifiers, used by Alembic.
revision: str = '6cc6330f1310'
down_revision: Union[str, None] = '9d4740cc405f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Ensure invoices.meta exists
    op.add_column(
        "invoices",
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="core",
    )

    # 2) Add new permissions (idempotent)
    perms = [
        ("finance.policy.view", "View finance policy"),
        ("finance.policy.manage", "Manage finance policy"),

        ("finance.fees.view", "View fee catalog/structures"),
        ("finance.fees.manage", "Manage fee catalog/structures"),

        ("finance.scholarships.view", "View scholarships"),
        ("finance.scholarships.manage", "Manage scholarships"),

        ("finance.invoices.view", "View invoices"),
        ("finance.invoices.manage", "Manage invoices"),

        ("finance.payments.manage", "Record payments"),

        ("enrollment.transfer.approve", "Approve student transfers"),
    ]

    op.execute(
        "INSERT INTO core.permissions (code, name) VALUES "
        + ", ".join([f"('{code}', '{name}')" for code, name in perms])
        + " ON CONFLICT (code) DO NOTHING"
    )

    # 3) Map permissions to roles (idempotent)
    # SUPER_ADMIN gets all finance + transfer approve
    op.execute("""
    INSERT INTO core.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM core.roles r
    JOIN core.permissions p ON p.code IN (
        'finance.policy.view','finance.policy.manage',
        'finance.fees.view','finance.fees.manage',
        'finance.scholarships.view','finance.scholarships.manage',
        'finance.invoices.view','finance.invoices.manage',
        'finance.payments.manage',
        'enrollment.transfer.approve'
    )
    WHERE r.code = 'SUPER_ADMIN'
    ON CONFLICT DO NOTHING
    """)

    # DIRECTOR gets all finance + transfer approve
    op.execute("""
    INSERT INTO core.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM core.roles r
    JOIN core.permissions p ON p.code IN (
        'finance.policy.view','finance.policy.manage',
        'finance.fees.view','finance.fees.manage',
        'finance.scholarships.view','finance.scholarships.manage',
        'finance.invoices.view','finance.invoices.manage',
        'finance.payments.manage',
        'enrollment.transfer.approve'
    )
    WHERE r.code = 'DIRECTOR'
    ON CONFLICT DO NOTHING
    """)

    # SECRETARY gets finance (but NOT transfer approve)
    op.execute("""
    INSERT INTO core.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM core.roles r
    JOIN core.permissions p ON p.code IN (
        'finance.policy.view',
        'finance.fees.view','finance.fees.manage',
        'finance.scholarships.view','finance.scholarships.manage',
        'finance.invoices.view','finance.invoices.manage',
        'finance.payments.manage'
    )
    WHERE r.code = 'SECRETARY'
    ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    # remove meta column
    op.drop_column("invoices", "meta", schema="core")

    # NOTE: We usually do NOT delete seeded permissions/mappings on downgrade in SaaS systems,
    # but if you want strict reversal we can implement deletes.
