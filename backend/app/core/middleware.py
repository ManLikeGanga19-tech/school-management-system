from uuid import UUID
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.database import SessionLocal
from app.models.tenant import Tenant


class TenantMiddleware(BaseHTTPMiddleware):
    """
    Enterprise multi-tenant resolver.

    Resolution order:
      1) X-Tenant-ID
      2) X-Tenant-Slug
      3) Host:
           - primary_domain match
           - subdomain slug
    """

    def _extract_host(self, request: Request) -> str:
        host = request.headers.get("host", "")
        return host.split(":")[0].lower()

    async def dispatch(self, request: Request, call_next):

        # Skip public docs
        if request.url.path in {"/docs", "/openapi.json", "/redoc"}:
            return await call_next(request)

        tenant_id_header = request.headers.get("x-tenant-id")
        tenant_slug_header = request.headers.get("x-tenant-slug")
        host = self._extract_host(request)

        db = SessionLocal()
        try:
            tenant = None

            # X-Tenant-ID
            if tenant_id_header:
                try:
                    tid = UUID(tenant_id_header)
                except Exception:
                    return JSONResponse(
                        {"detail": "Invalid X-Tenant-ID header (must be UUID)."},
                        status_code=400,
                    )
                tenant = db.query(Tenant).filter(Tenant.id == tid).first()

            # X-Tenant-Slug
            if tenant is None and tenant_slug_header:
                tenant = (
                    db.query(Tenant)
                    .filter(Tenant.slug == tenant_slug_header.lower())
                    .first()
                )

            # Host-based resolution
            if tenant is None and host:
                tenant = db.query(Tenant).filter(Tenant.primary_domain == host).first()

                if tenant is None and "." in host:
                    slug = host.split(".")[0]
                    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()

            if tenant is None:
                return JSONResponse(
                    {"detail": "Tenant not resolved."},
                    status_code=400,
                )

            # Soft delete protection
            if tenant.deleted_at is not None:
                return JSONResponse(
                    {"detail": "Tenant has been deleted."},
                    status_code=403,
                )

            if not tenant.is_active:
                return JSONResponse(
                    {"detail": "Tenant is suspended."},
                    status_code=403,
                )

            # Attach full tenant object
            request.state.tenant = tenant
            request.state.tenant_id = tenant.id
            request.state.tenant_slug = tenant.slug

            return await call_next(request)

        finally:
            db.close()
