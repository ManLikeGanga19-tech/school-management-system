from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.tenant import Tenant


def create_tenant(db: Session, payload):
    tenant = Tenant(
        name=payload.name,
        slug=payload.slug.lower(),
        primary_domain=payload.primary_domain,
        is_active=True,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


def suspend_tenant(db: Session, tenant_id):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise ValueError("Tenant not found")

    tenant.is_active = False
    db.commit()
    return tenant


def soft_delete_tenant(db: Session, tenant_id):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise ValueError("Tenant not found")

    tenant.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return tenant


def list_tenants(db: Session):
    return db.query(Tenant).all()

def update_tenant(db: Session, tenant_id, payload):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise ValueError("Tenant not found")

    if payload.name:
        tenant.name = payload.name

    if payload.primary_domain:
        tenant.primary_domain = payload.primary_domain

    if payload.slug:
        tenant.slug = payload.slug.lower()

    db.commit()
    db.refresh(tenant)
    return tenant
