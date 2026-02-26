from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class EnrollmentCreate(BaseModel):
    """Body for POST / — creates a new DRAFT enrollment."""
    payload: Dict[str, Any]


class EnrollmentUpdate(BaseModel):
    """
    Body for PATCH /{id}.

    Only fields present in `payload` are merged into the existing record.
    Pass ``payload: {}`` to touch updated_at without changing any field.
    Passing ``None`` is a no-op (useful for touch-only calls in the future).
    """
    payload: Optional[Dict[str, Any]] = None


class EnrollmentEnrollRequest(BaseModel):
    """
    Body for POST /{id}/enroll.

    `admission_number` is optional — if omitted the backend auto-generates
    one in the format ADM-XXXX based on the highest existing number for
    this tenant.
    """
    admission_number: Optional[str] = Field(
        default=None,
        description="e.g. ADM-1042. Auto-generated if not supplied.",
    )


class EnrollmentRejectRequest(BaseModel):
    """Body for POST /{id}/reject."""
    reason: Optional[str] = Field(
        default=None,
        description="Human-readable rejection reason stored in audit log.",
    )


class EnrollmentDirectorOverrideRequest(BaseModel):
    """
    Body for POST /{id}/director-override.

    Allows a director to clear the secretary edit lock on an enrolled
    student's record, resetting the counter to 0 so further edits are
    permitted.  The note is written to the audit log alongside the
    director's identity.
    """
    note: Optional[str] = Field(
        default=None,
        description="Director's reason for overriding the edit lock.",
    )


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------

class EnrollmentOut(BaseModel):
    """
    Full enrollment record returned by all endpoints.

    Key fields for the UI:
      - admission_number      : None until status reaches ENROLLED.
      - secretary_edit_count  : 0-3, incremented on each secretary update
                                of an ENROLLED/ENROLLED_PARTIAL record.
      - secretary_edit_locked : True once the limit is reached; a director
                                must call director-override to clear it.
    """
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    student_id: Optional[UUID] = None

    status: str
    admission_number: Optional[str] = None

    # Secretary edit-limit tracking
    secretary_edit_count: int = 0
    secretary_edit_locked: bool = False

    payload: Dict[str, Any]

    created_by: Optional[UUID] = None
    updated_by: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None