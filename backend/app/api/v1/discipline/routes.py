"""Discipline module API.

Endpoints:
  GET    /discipline/incidents                              — list incidents (paginated)
  POST   /discipline/incidents                              — create incident
  GET    /discipline/incidents/{id}                         — incident detail
  PATCH  /discipline/incidents/{id}                         — update incident
  POST   /discipline/incidents/{id}/students                — add student to incident
  PATCH  /discipline/incidents/{id}/students/{link_id}      — update student link
  DELETE /discipline/incidents/{id}/students/{link_id}      — remove student from incident
  POST   /discipline/incidents/{id}/followups               — add follow-up note
  GET    /students/{student_id}/discipline                  — student discipline history
"""
from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_tenant, require_permission

from . import service
from .schemas import (
    FollowupCreate,
    FollowupOut,
    IncidentCreate,
    IncidentListItem,
    IncidentOut,
    IncidentStudentCreate,
    IncidentStudentUpdate,
    IncidentUpdate,
)

router = APIRouter()
students_router = APIRouter()  # mounted at /students in the main router


# ── Incidents ─────────────────────────────────────────────────────────────────

@router.get(
    "/incidents",
    dependencies=[Depends(require_permission("discipline.incidents.view"))],
)
def list_incidents(
    student_id: UUID | None = Query(None),
    status: str | None = Query(None),
    incident_type: str | None = Query(None),
    severity: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    items, total = service.list_incidents(
        db,
        tenant_id=tenant.id,
        student_id=student_id,
        status=status,
        incident_type=incident_type,
        severity=severity,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return {"ok": True, "total": total, "items": items}


@router.post(
    "/incidents",
    status_code=201,
    dependencies=[Depends(require_permission("discipline.incidents.manage"))],
)
def create_incident(
    payload: IncidentCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    result = service.create_incident(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        data=payload.model_dump(),
    )
    db.commit()
    return {"ok": True, "incident": result}


@router.get(
    "/incidents/{incident_id}",
    dependencies=[Depends(require_permission("discipline.incidents.view"))],
)
def get_incident(
    incident_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    result = service.get_incident(db, tenant_id=tenant.id, incident_id=incident_id)
    return {"ok": True, "incident": result}


@router.patch(
    "/incidents/{incident_id}",
    dependencies=[Depends(require_permission("discipline.incidents.manage"))],
)
def update_incident(
    incident_id: UUID,
    payload: IncidentUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    result = service.update_incident(
        db,
        tenant_id=tenant.id,
        incident_id=incident_id,
        updates=payload.model_dump(exclude_none=True),
    )
    db.commit()
    return {"ok": True, "incident": result}


# ── Incident students ─────────────────────────────────────────────────────────

@router.post(
    "/incidents/{incident_id}/students",
    status_code=201,
    dependencies=[Depends(require_permission("discipline.incidents.manage"))],
)
def add_student(
    incident_id: UUID,
    payload: IncidentStudentCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    result = service.add_student_to_incident(
        db,
        tenant_id=tenant.id,
        incident_id=incident_id,
        data=payload.model_dump(),
    )
    db.commit()
    return {"ok": True, "incident": result}


@router.patch(
    "/incidents/{incident_id}/students/{link_id}",
    dependencies=[Depends(require_permission("discipline.incidents.manage"))],
)
def update_student_link(
    incident_id: UUID,
    link_id: UUID,
    payload: IncidentStudentUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    result = service.update_incident_student(
        db,
        tenant_id=tenant.id,
        incident_id=incident_id,
        link_id=link_id,
        updates=payload.model_dump(exclude_none=True),
    )
    db.commit()
    return {"ok": True, "incident": result}


@router.delete(
    "/incidents/{incident_id}/students/{link_id}",
    status_code=204,
    dependencies=[Depends(require_permission("discipline.incidents.manage"))],
)
def remove_student(
    incident_id: UUID,
    link_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    service.remove_student_from_incident(
        db,
        tenant_id=tenant.id,
        incident_id=incident_id,
        link_id=link_id,
    )
    db.commit()
    return Response(status_code=204)


# ── Follow-ups ────────────────────────────────────────────────────────────────

@router.post(
    "/incidents/{incident_id}/followups",
    status_code=201,
    dependencies=[Depends(require_permission("discipline.incidents.manage"))],
)
def add_followup(
    incident_id: UUID,
    payload: FollowupCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    result = service.add_followup(
        db,
        tenant_id=tenant.id,
        incident_id=incident_id,
        actor_user_id=user.id,
        data=payload.model_dump(),
    )
    db.commit()
    return {"ok": True, "incident": result}


# ── Student discipline history (mounted under /students router) ───────────────

@students_router.get(
    "/{student_id}/discipline",
    dependencies=[Depends(require_permission("discipline.incidents.view"))],
)
def student_discipline_history(
    student_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    history = service.get_student_discipline_history(
        db, tenant_id=tenant.id, student_id=student_id
    )
    return {"ok": True, "student_id": str(student_id), "incidents": history}
