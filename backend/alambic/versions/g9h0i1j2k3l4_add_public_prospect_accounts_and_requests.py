"""add public prospect accounts, sessions, and requests

Revision ID: g9h0i1j2k3l4
Revises: f8g9h0i1j2k3
Create Date: 2026-03-11 17:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "g9h0i1j2k3l4"
down_revision: Union[str, None] = "f8g9h0i1j2k3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prospect_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("organization_name", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("job_title", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_prospect_accounts_email"),
        schema="core",
    )

    op.create_table(
        "prospect_auth_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("refresh_token_hash", sa.String(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("now()")),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["core.prospect_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="core",
    )
    op.create_index(
        "ix_prospect_auth_sessions_account_id",
        "prospect_auth_sessions",
        ["account_id"],
        unique=False,
        schema="core",
    )

    op.create_table(
        "prospect_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default=sa.text("'NEW'")),
        sa.Column("organization_name", sa.String(), nullable=False),
        sa.Column("contact_name", sa.String(), nullable=False),
        sa.Column("contact_email", sa.String(), nullable=False),
        sa.Column("contact_phone", sa.String(), nullable=True),
        sa.Column("student_count", sa.Integer(), nullable=True),
        sa.Column("preferred_contact_method", sa.String(), nullable=True),
        sa.Column("preferred_contact_window", sa.String(), nullable=True),
        sa.Column("requested_domain", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "request_type IN ('DEMO', 'ENQUIRY', 'SCHOOL_VISIT')",
            name="ck_prospect_requests_type",
        ),
        sa.CheckConstraint(
            "status IN ('NEW', 'CONTACTING', 'SCHEDULED', 'CLOSED')",
            name="ck_prospect_requests_status",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["core.prospect_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="core",
    )
    op.create_index(
        "ix_prospect_requests_account_id_created_at",
        "prospect_requests",
        ["account_id", "created_at"],
        unique=False,
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_prospect_requests_account_id_created_at", table_name="prospect_requests", schema="core")
    op.drop_table("prospect_requests", schema="core")
    op.drop_index("ix_prospect_auth_sessions_account_id", table_name="prospect_auth_sessions", schema="core")
    op.drop_table("prospect_auth_sessions", schema="core")
    op.drop_table("prospect_accounts", schema="core")
