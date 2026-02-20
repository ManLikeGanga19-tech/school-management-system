# app/core/middleware.py

from __future__ import annotations

from uuid import UUID

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import SessionLocal
from app.models.tenant import Tenant


class TenantMiddleware(BaseHTTPMiddleware):
    """
    Multi-tenant resolver (enterprise hybrid).

    Resolution order:
      1) X-Tenant-ID (UUID)
      2) X-Tenant-Slug
      3) Host header:
          - match Tenant.primary_domain exactly
          - OR parse subdomain from <slug>.<base_domain> (optional)

    Notes:
      - Soft delete / suspension: is_active=False => inactive.
      - Attach tenant context on request.state.
      - SaaS routes (super admin / platform ops) MUST bypass tenant resolution.
    """

    def _extract_host(self, request: Request) -> str:
        host = request.headers.get("host", "")
        return host.split(":")[0].lower()

    def _is_public_path(self, path: str) -> bool:
        # Docs / OpenAPI
        if path in {"/docs", "/openapi.json", "/redoc"}:
            return True

        # ✅ SaaS auth endpoints do NOT require tenant
        if path.startswith("/api/v1/auth/login/saas"):
            return True
        if path.startswith("/api/v1/auth/refresh/saas"):
            return True
        if path.startswith("/api/v1/auth/logout/saas"):
            return True
        if path.startswith("/api/v1/auth/me/saas"):
            return True

        # ✅ SaaS / Super Admin endpoints do NOT require tenant
        # Covers:
        # - /api/v1/admin/saas/...
        # - /api/v1/admin/tenants...
        # - /api/v1/admin/audit/...
        # - /api/v1/admin/rbac/...
        if path.startswith("/api/v1/admin/saas"):
            return True
        if path.startswith("/api/v1/admin/tenants"):
            return True
        if path.startswith("/api/v1/admin/audit"):
            return True
        if path.startswith("/api/v1/admin/rbac"):
            return True

        return False

    async def dispatch(self, request: Request, call_next):
        path = str(request.url.path)

        # ✅ Always allow CORS preflight
        if request.method.upper() == "OPTIONS":
            return await call_next(request)

        # ✅ Skip tenant resolution for public / saas paths
        if self._is_public_path(path):
            return await call_next(request)

        tenant_id_header = request.headers.get("x-tenant-id")
        tenant_slug_header = request.headers.get("x-tenant-slug")
        host = self._extract_host(request)

        db = SessionLocal()
        try:
            tenant = None

            try:
                # 1) X-Tenant-ID
                if tenant_id_header:
                    try:
                        tid = UUID(tenant_id_header)
                    except Exception:
                        return JSONResponse(
                            {"detail": "Invalid X-Tenant-ID header (must be UUID)."},
                            status_code=400,
                        )
                    tenant = db.query(Tenant).filter(Tenant.id == tid).first()

                # 2) X-Tenant-Slug
                if tenant is None and tenant_slug_header:
                    tenant = (
                        db.query(Tenant)
                        .filter(Tenant.slug == tenant_slug_header.lower())
                        .first()
                    )

                # 3) Host-based resolution
                if tenant is None and host:
                    tenant = db.query(Tenant).filter(Tenant.primary_domain == host).first()

                    if tenant is None and "." in host:
                        slug = host.split(".")[0]
                        tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
            except SQLAlchemyError:
                return JSONResponse({"detail": "Database unavailable"}, status_code=503)

            if tenant is None:
                return JSONResponse(
                    {
                        "detail": "Tenant not resolved. Provide X-Tenant-ID / X-Tenant-Slug or use a mapped domain."
                    },
                    status_code=400,
                )

            if not tenant.is_active:
                return JSONResponse({"detail": "Tenant is inactive."}, status_code=403)

            request.state.tenant = tenant
            request.state.tenant_id = tenant.id
            request.state.tenant_slug = tenant.slug

            return await call_next(request)
        finally:
            db.close()
