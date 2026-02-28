"""add tenant notification reads table

Revision ID: s5t6u7v8w9x0
Revises: r4s5t6u7v8x9
Create Date: 2026-03-01 00:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "s5t6u7v8w9x0"
down_revision: Union[str, None] = "r4s5t6u7v8x9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_notification_reads",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("notification_id", sa.String(length=255), nullable=False),
        sa.Column(
            "read_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "tenant_id",
            "user_id",
            "notification_id",
            name="uq_tenant_notification_reads_tenant_user_notification",
        ),
        schema="core",
    )
    op.create_index(
        "ix_tenant_notification_reads_tenant_user_read_at",
        "tenant_notification_reads",
        ["tenant_id", "user_id", "read_at"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tenant_notification_reads_tenant_user_read_at",
        table_name="tenant_notification_reads",
        schema="core",
    )
    op.drop_table("tenant_notification_reads", schema="core")
