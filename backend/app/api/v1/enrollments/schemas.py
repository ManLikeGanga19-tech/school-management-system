from pydantic import BaseModel, ConfigDict
from typing import Any, Dict, Optional
from uuid import UUID


class EnrollmentCreate(BaseModel):
    payload: Dict[str, Any]


class EnrollmentUpdate(BaseModel):
    payload: Optional[Dict[str, Any]] = None


class EnrollmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    status: str
    payload: Dict[str, Any]
