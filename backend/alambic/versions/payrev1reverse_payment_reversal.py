"""Payment reversal — columns + director-only permission.

Adds the reversal audit columns to core.payments and a new gateable permission
`finance.payments.reverse`, granted to the global DIRECTOR role only (secretaries
record payments but cannot reverse them). Global role grant → applies to every
current and future tenant. Idempotent.

Revision ID: payrev1reverse
Revises: roleperm1matrix
"""
from alembic import op
import sqlalchemy as sa

revision = "payrev1reverse"
down_revision = "roleperm1matrix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True), schema="core")
    op.add_column("payments", sa.Column("reversed_by", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True), schema="core")
    op.add_column("payments", sa.Column("reversal_reason", sa.String(500), nullable=True), schema="core")

    # New permission + grant to DIRECTOR only.
    op.execute(
        """
        INSERT INTO core.permissions (code, name, description, category)
        VALUES ('finance.payments.reverse', 'Reverse payments',
                'Reverse a recorded payment and restore affected invoices', 'finance')
        ON CONFLICT (code) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM core.roles r
        JOIN core.permissions p ON p.code = 'finance.payments.reverse'
        WHERE r.tenant_id IS NULL AND r.code = 'DIRECTOR'
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM core.role_permissions rp USING core.permissions p WHERE rp.permission_id = p.id AND p.code = 'finance.payments.reverse'")
    op.execute("DELETE FROM core.permissions WHERE code = 'finance.payments.reverse'")
    op.drop_column("payments", "reversal_reason", schema="core")
    op.drop_column("payments", "reversed_by", schema="core")
    op.drop_column("payments", "reversed_at", schema="core")
