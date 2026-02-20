from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import select, and_

from app.core.database import get_db
from app.core.dependencies import get_tenant, require_permission
from app.models.audit_log import AuditLog


router = APIRouter()


def _is_saas_scope(request: Request) -> bool:
    """
    SaaS scope = SUPER_ADMIN-style permissions.
    We treat 'tenants.read_all' or 'admin.dashboard.view_all' as cross-tenant capability.
    """
    perms = getattr(request.state, "permissions", []) or []
    return ("tenants.read_all" in perms) or ("admin.dashboard.view_all" in perms)


@router.get("/logs")
def list_audit_logs(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("audit.read")),
    tenant_id: Optional[UUID] = Query(default=None),  # only honored for SaaS scope
    actor_user_id: Optional[UUID] = Query(default=None),
    action: Optional[str] = Query(default=None),
    resource: Optional[str] = Query(default=None),
    resource_id: Optional[UUID] = Query(default=None),
    request_id: Optional[str] = Query(default=None),  # meta.request_id
    from_dt: Optional[datetime] = Query(default=None),
    to_dt: Optional[datetime] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    saas = _is_saas_scope(request)

    # Tenant isolation:
    effective_tenant_id = tenant.id
    if saas and tenant_id is not None:
        effective_tenant_id = tenant_id

    stmt = select(AuditLog).where(AuditLog.tenant_id == effective_tenant_id)

    if actor_user_id:
        stmt = stmt.where(AuditLog.actor_user_id == actor_user_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource:
        stmt = stmt.where(AuditLog.resource == resource)
    if resource_id:
        stmt = stmt.where(AuditLog.resource_id == resource_id)

    if request_id:
        # meta is JSONB; using ->> to get text value
        stmt = stmt.where(AuditLog.meta["request_id"].astext == request_id)

    if from_dt:
        stmt = stmt.where(AuditLog.created_at >= from_dt)
    if to_dt:
        stmt = stmt.where(AuditLog.created_at <= to_dt)

    stmt = stmt.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)

    rows = db.execute(stmt).scalars().all()

    return [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id),
            "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
            "action": r.action,
            "resource": r.resource,
            "resource_id": str(r.resource_id) if r.resource_id else None,
            "payload": r.payload,
            "meta": r.meta,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@router.get("/logs/{log_id}")
def get_audit_log(
    log_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("audit.read")),
):
    row = db.get(AuditLog, log_id)
    if not row:
        raise HTTPException(status_code=404, detail="Audit log not found")

    saas = _is_saas_scope(request)
    if not saas and row.tenant_id != tenant.id:
        raise HTTPException(status_code=403, detail="Not allowed")

    return {
        "id": str(row.id),
        "tenant_id": str(row.tenant_id),
        "actor_user_id": str(row.actor_user_id) if row.actor_user_id else None,
        "action": row.action,
        "resource": row.resource,
        "resource_id": str(row.resource_id) if row.resource_id else None,
        "payload": row.payload,
        "meta": row.meta,
        "created_at": row.created_at,
    }
