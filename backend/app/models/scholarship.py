from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class Scholarship(Base):
    __tablename__ = "scholarships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_scholarships_tenant_name"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(160), nullable=False)
    # PERCENTAGE | FIXED | FULL_WAIVER (CHECK constraint enforces — see
    # migration sch1f2w3a4v5). FULL_WAIVER ignores `value` and waives the
    # invoice's current-term total at allocation time.
    type = Column(String(20), nullable=False)
    value = Column(Numeric(12, 2), nullable=False)

    # If set, caps the unique-student recipient count. For FIXED with a pool,
    # the per-student amount is `value / max_recipients`. For PERCENTAGE and
    # FULL_WAIVER the value math doesn't apply, but the recipient cap still
    # does — useful for "first 20 top performers get a full scholarship".
    max_recipients = Column(Integer, nullable=True)

    # When TRUE, a FULL_WAIVER also clears bundled carry-forward arrears on
    # the invoice it's applied to. Default FALSE keeps the conservative
    # policy that bursaries don't retroactively erase prior debt.
    covers_carry_forward = Column(
        Boolean, nullable=False, server_default=text("false")
    )

    description = Column(String(500), nullable=True)

    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
