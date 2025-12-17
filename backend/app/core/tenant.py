from fastapi import Request, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.tenant import Tenant
from app.core.database import get_db


class TenantContext:
    def __init__(self, tenant):
        self.id = tenant.id
        self.slug = tenant.slug
        self.name = tenant.name


def resolve_tenant_from_host(db: Session, host: str) -> TenantContext:
    """
    Resolve tenant using full domain or subdomain.
    """

    # strip port if present
    domain = host.split(":")[0].lower()

    stmt = select(Tenant).where(
        (Tenant.primary_domain == domain) |
        (Tenant.slug == domain.split(".")[0])
    )

    tenant = db.execute(stmt).scalar_one_or_none()

    if not tenant or not tenant.is_active:
        raise HTTPException(
            status_code=404,
            detail="School not found or inactive"
        )

    return TenantContext(tenant)
