from __future__ import annotations

from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


SupportThreadStatus = Literal[
    "OPEN",
    "WAITING_ADMIN",
    "WAITING_TENANT",
    "RESOLVED",
    "CLOSED",
]

SupportThreadPriority = Literal["LOW", "NORMAL", "HIGH", "URGENT"]
SupportSenderMode = Literal["TENANT", "SAAS_ADMIN", "SYSTEM"]


class SupportThreadOut(BaseModel):
    id: str
    tenant_id: str
    tenant_name: Optional[str] = None
    tenant_slug: Optional[str] = None
    subject: str
    status: SupportThreadStatus
    priority: SupportThreadPriority
    last_message_preview: Optional[str] = None
    unread_for_tenant: int = 0
    unread_for_admin: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    last_message_at: Optional[str] = None


class SupportMessageOut(BaseModel):
    id: str
    thread_id: str
    tenant_id: str
    sender_user_id: Optional[str] = None
    sender_mode: SupportSenderMode
    sender_name: Optional[str] = None
    sender_email: Optional[str] = None
    reply_to_message_id: Optional[str] = None
    reply_to_body: Optional[str] = None
    reply_to_sender_mode: Optional[SupportSenderMode] = None
    reply_to_sender_name: Optional[str] = None
    body: str
    created_at: Optional[str] = None


class TenantSupportThreadCreateIn(BaseModel):
    subject: Optional[str] = Field(default=None, max_length=200)
    priority: SupportThreadPriority = "NORMAL"
    message: str = Field(..., min_length=1, max_length=4000)


class SupportMessageCreateIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    reply_to_message_id: Optional[UUID] = None


class SupportThreadStatusUpdateIn(BaseModel):
    status: SupportThreadStatus


class SupportUnreadCountOut(BaseModel):
    unread_count: int = 0
