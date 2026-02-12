from pydantic import BaseModel
from uuid import UUID
from typing import Optional
from datetime import datetime


class TenantCreate(BaseModel):
    name: str
    slug: str
    primary_domain: Optional[str] = None


class TenantOut(BaseModel):
    id: UUID
    name: str
    slug: str
    primary_domain: Optional[str]
    is_active: bool
    deleted_at: Optional[datetime]

    class Config:
        from_attributes = True
