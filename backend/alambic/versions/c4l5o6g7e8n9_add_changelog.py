"""add changelog entries + per-user seen marker

In-app "What's New" — the super-admin publishes changelog entries; each
tenant user sees a banner for entries published after their
changelog_seen_at. Existing users are backfilled to now() so they start
caught up (no flood of historical entries).

Revision ID: c4l5o6g7e8n9
Revises: h2s3t4o5v6r7
Create Date: 2026-05-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "c4l5o6g7e8n9"
down_revision = "h2s3t4o5v6r7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "changelog_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False, server_default=sa.text("'new'")),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        schema="core",
    )
    op.create_index(
        "ix_core_changelog_published",
        "changelog_entries",
        ["is_published", "published_at"],
        schema="core",
    )

    op.add_column(
        "users",
        sa.Column("changelog_seen_at", sa.DateTime(timezone=True), nullable=True),
        schema="core",
    )
    # Existing users start caught up — only future entries notify them.
    op.execute("UPDATE core.users SET changelog_seen_at = now() WHERE changelog_seen_at IS NULL")


def downgrade() -> None:
    op.drop_column("users", "changelog_seen_at", schema="core")
    op.drop_index("ix_core_changelog_published", table_name="changelog_entries", schema="core")
    op.drop_table("changelog_entries", schema="core")
