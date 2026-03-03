"""add support message reply reference

Revision ID: d6e7f8g9h0i1
Revises: c5d6e7f8g9h0
Create Date: 2026-03-03 22:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "d6e7f8g9h0i1"
down_revision: Union[str, None] = "c5d6e7f8g9h0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "support_messages",
        sa.Column("reply_to_message_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="core",
    )
    op.create_foreign_key(
        "fk_support_messages_reply_to",
        "support_messages",
        "support_messages",
        ["reply_to_message_id"],
        ["id"],
        source_schema="core",
        referent_schema="core",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_support_messages_reply_to",
        "support_messages",
        ["reply_to_message_id"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_support_messages_reply_to", table_name="support_messages", schema="core")
    op.drop_constraint("fk_support_messages_reply_to", "support_messages", schema="core", type_="foreignkey")
    op.drop_column("support_messages", "reply_to_message_id", schema="core")
