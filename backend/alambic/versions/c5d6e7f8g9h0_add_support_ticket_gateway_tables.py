"""add support ticket gateway tables

Revision ID: c5d6e7f8g9h0
Revises: b4c5d6e7f8g9
Create Date: 2026-03-03 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "c5d6e7f8g9h0"
down_revision: Union[str, None] = "b4c5d6e7f8g9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "support_threads",
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
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("subject", sa.String(length=200), nullable=False, server_default=sa.text("'General Support'")),
        sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'OPEN'")),
        sa.Column("priority", sa.String(length=16), nullable=False, server_default=sa.text("'NORMAL'")),
        sa.Column("last_message_preview", sa.String(length=500), nullable=True),
        sa.Column("unread_for_tenant", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("unread_for_admin", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema="core",
    )

    op.create_table(
        "support_messages",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "thread_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.support_threads.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sender_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("sender_mode", sa.String(length=16), nullable=False, server_default=sa.text("'TENANT'")),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema="core",
    )

    op.create_index(
        "ix_support_threads_tenant_last_message",
        "support_threads",
        ["tenant_id", "last_message_at"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_support_threads_status_last_message",
        "support_threads",
        ["status", "last_message_at"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_support_threads_unread_admin",
        "support_threads",
        ["unread_for_admin", "last_message_at"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_support_messages_thread_created",
        "support_messages",
        ["thread_id", "created_at"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_support_messages_tenant_created",
        "support_messages",
        ["tenant_id", "created_at"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_support_messages_tenant_created", table_name="support_messages", schema="core")
    op.drop_index("ix_support_messages_thread_created", table_name="support_messages", schema="core")
    op.drop_index("ix_support_threads_unread_admin", table_name="support_threads", schema="core")
    op.drop_index("ix_support_threads_status_last_message", table_name="support_threads", schema="core")
    op.drop_index("ix_support_threads_tenant_last_message", table_name="support_threads", schema="core")

    op.drop_table("support_messages", schema="core")
    op.drop_table("support_threads", schema="core")
