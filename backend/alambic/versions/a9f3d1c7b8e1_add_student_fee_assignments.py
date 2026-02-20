"""add student_fee_assignments table

Revision ID: a9f3d1c7b8e1
Revises: 6cc6330f1310
Create Date: 2026-02-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'a9f3d1c7b8e1'
down_revision = '6cc6330f1310'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "student_fee_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("enrollment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fee_structure_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("core.fee_structures.id", ondelete="SET NULL"), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("status", sa.String(), nullable=False, server_default=sa.text("'assigned'")),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="core",
    )


def downgrade() -> None:
    op.drop_table("student_fee_assignments", schema="core")
