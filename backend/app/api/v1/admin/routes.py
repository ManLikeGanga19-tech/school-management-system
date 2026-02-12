from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.api.v1.admin import service
from app.api.v1.admin.schemas import TenantCreate, TenantOut

router = APIRouter()


@router.post(
    "/tenants",
    response_model=TenantOut,
    dependencies=[Depends(require_permission("tenants.create"))],
)
def create_tenant(payload: TenantCreate, db: Session = Depends(get_db)):
    return service.create_tenant(db, payload)


@router.get(
    "/tenants",
    dependencies=[Depends(require_permission("tenants.read_all"))],
)
def list_tenants(db: Session = Depends(get_db)):
    return service.list_tenants(db)


@router.patch(
    "/tenants/{tenant_id}",
    dependencies=[Depends(require_permission("tenants.update"))],
)
def update_tenant_endpoint(
    tenant_id: UUID,
    payload: TenantCreate,
    db: Session = Depends(get_db),
):
    try:
        return service.update_tenant(db, tenant_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.patch(
    "/tenants/{tenant_id}/suspend",
    dependencies=[Depends(require_permission("tenants.suspend"))],
)
def suspend_tenant(tenant_id: UUID, db: Session = Depends(get_db)):
    try:
        return service.suspend_tenant(db, tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete(
    "/tenants/{tenant_id}",
    dependencies=[Depends(require_permission("tenants.delete"))],
)
def delete_tenant(tenant_id: UUID, db: Session = Depends(get_db)):
    try:
        return service.soft_delete_tenant(db, tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
