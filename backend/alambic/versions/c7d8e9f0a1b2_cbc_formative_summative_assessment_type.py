"""CBC assessments: add assessment_type (FORMATIVE/SUMMATIVE) and checkpoint_no

Revision ID: c7d8e9f0a1b2
Revises: b1c2d3e4f5g6
Create Date: 2026-04-14 09:00:00.000000

Changes:
- Add assessment_type VARCHAR(12) NOT NULL DEFAULT 'SUMMATIVE' to core.cbc_assessments
- Add checkpoint_no SMALLINT NOT NULL DEFAULT 1 (used for multiple formative checkpoints)
- Drop old unique constraint (enrollment_id, sub_strand_id, term_id)
- Add partial unique index for SUMMATIVE: unique (enrollment_id, sub_strand_id, term_id)
  WHERE assessment_type='SUMMATIVE'
- Add unique index for FORMATIVE: unique (enrollment_id, sub_strand_id, term_id, checkpoint_no)
  WHERE assessment_type='FORMATIVE'
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "b1c2d3e4f5g6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add new columns with defaults
    op.add_column(
        "cbc_assessments",
        sa.Column(
            "assessment_type",
            sa.String(12),
            nullable=False,
            server_default="SUMMATIVE",
        ),
        schema="core",
    )
    op.add_column(
        "cbc_assessments",
        sa.Column(
            "checkpoint_no",
            sa.SmallInteger(),
            nullable=False,
            server_default="1",
        ),
        schema="core",
    )

    # 2. Drop the old unique constraint
    op.drop_constraint(
        "uq_cbc_assessment_enrollment_substrand_term",
        "cbc_assessments",
        schema="core",
        type_="unique",
    )

    # 3. Partial unique index for SUMMATIVE — one per sub-strand per term per learner
    op.execute(
        """
        CREATE UNIQUE INDEX uq_cbc_summative
        ON core.cbc_assessments (enrollment_id, sub_strand_id, term_id)
        WHERE assessment_type = 'SUMMATIVE'
        """
    )

    # 4. Unique index for FORMATIVE — one per checkpoint per sub-strand per term per learner
    op.execute(
        """
        CREATE UNIQUE INDEX uq_cbc_formative
        ON core.cbc_assessments (enrollment_id, sub_strand_id, term_id, checkpoint_no)
        WHERE assessment_type = 'FORMATIVE'
        """
    )

    # 5. Check constraints
    op.execute(
        """
        ALTER TABLE core.cbc_assessments
        ADD CONSTRAINT chk_cbc_assessment_type
        CHECK (assessment_type IN ('FORMATIVE', 'SUMMATIVE'))
        """
    )

    op.execute(
        """
        ALTER TABLE core.cbc_assessments
        ADD CONSTRAINT chk_cbc_checkpoint_no
        CHECK (checkpoint_no BETWEEN 1 AND 10)
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE core.cbc_assessments DROP CONSTRAINT IF EXISTS chk_cbc_checkpoint_no")
    op.execute("ALTER TABLE core.cbc_assessments DROP CONSTRAINT IF EXISTS chk_cbc_assessment_type")
    op.execute("DROP INDEX IF EXISTS core.uq_cbc_formative")
    op.execute("DROP INDEX IF EXISTS core.uq_cbc_summative")

    op.create_unique_constraint(
        "uq_cbc_assessment_enrollment_substrand_term",
        "cbc_assessments",
        ["enrollment_id", "sub_strand_id", "term_id"],
        schema="core",
    )

    op.drop_column("cbc_assessments", "checkpoint_no", schema="core")
    op.drop_column("cbc_assessments", "assessment_type", schema="core")
