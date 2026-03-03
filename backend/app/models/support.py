from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class SupportThread(Base):
    __tablename__ = "support_threads"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("core.users.id", ondelete="SET NULL"), nullable=True)
    subject = Column(String(200), nullable=False, server_default=text("'General Support'"))
    status = Column(String(24), nullable=False, server_default=text("'OPEN'"))
    priority = Column(String(16), nullable=False, server_default=text("'NORMAL'"))
    last_message_preview = Column(String(500), nullable=True)
    unread_for_tenant = Column(Integer, nullable=False, server_default=text("0"))
    unread_for_admin = Column(Integer, nullable=False, server_default=text("0"))
    last_message_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class SupportMessage(Base):
    __tablename__ = "support_messages"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    thread_id = Column(UUID(as_uuid=True), ForeignKey("core.support_threads.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    reply_to_message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.support_messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    sender_user_id = Column(UUID(as_uuid=True), ForeignKey("core.users.id", ondelete="SET NULL"), nullable=True)
    sender_mode = Column(String(16), nullable=False, server_default=text("'TENANT'"))
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
