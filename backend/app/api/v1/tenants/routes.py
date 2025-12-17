from fastapi import APIRouter, Depends
from app.core.dependencies import get_tenant

router = APIRouter()


@router.get("/whoami")
def whoami(tenant=Depends(get_tenant)):
    return {
        "tenant_id": str(tenant.id),
        "tenant_slug": tenant.slug,
        "tenant_name": tenant.name
    }
