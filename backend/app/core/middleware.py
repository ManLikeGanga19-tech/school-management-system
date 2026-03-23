# app/core/middleware.py

from __future__ import annotations

from uuid import UUID
from types import SimpleNamespace
import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from sqlalchemy.exc import ProgrammingError, SQLAlchemyError

from app.core.database import SessionLocal, database_status
from app.core.logging_config import log_tenant_id
from app.models.tenant import Tenant

logger = logging.getLogger(__name__)


def _is_missing_relation_error(exc: ProgrammingError) -> bool:
    orig = getattr(exc, "orig", None)
    sqlstate = getattr(orig, "sqlstate", None)
    if sqlstate == "42P01":
        return True
    return "does not exist" in str(exc).lower()


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
        host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
        host = host.split(",")[0].strip()
        return host.split(":")[0].lower()

    def _is_public_path(self, path: str) -> bool:
        # Docs / OpenAPI
        if path in {"/docs", "/openapi.json", "/redoc"}:
            return True
        # Infra health endpoints must bypass tenant resolution
        if path in {"/healthz", "/readyz"}:
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

        # ✅ Tenant refresh/logout should rely on refresh token payload,
        # not tenant headers/domain mapping.
        if path.startswith("/api/v1/auth/refresh"):
            return True
        if path.startswith("/api/v1/auth/logout"):
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
        # Subscriptions endpoints are SaaS-level admin operations
        if path.startswith("/api/v1/admin/subscriptions"):
            return True
        if path.startswith("/api/v1/admin/audit"):
            return True
        if path.startswith("/api/v1/admin/rbac"):
            return True
        # Support inbox for SaaS operators (cross-tenant) must not require tenant headers
        if path.startswith("/api/v1/support/admin"):
            return True
        if path.startswith("/api/v1/public"):
            return True
        # Daraja M-Pesa callback is called by Safaricom directly (no tenant context)
        if path.startswith("/api/v1/payments/daraja/callback"):
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

        tenant = None
        db = SessionLocal()
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
        except ProgrammingError as exc:
            if _is_missing_relation_error(exc):
                logger.error(
                    "Tenant middleware blocked because required tenant schema is missing on path=%s host=%s",
                    path,
                    host,
                )
                return JSONResponse(
                    {
                        "detail": "Database schema not initialized. Run migrations before serving tenant traffic."
                    },
                    status_code=503,
                )
            logger.exception("Tenant middleware DB error on path=%s host=%s", path, host)
            return JSONResponse({"detail": "Database unavailable"}, status_code=503)
        except SQLAlchemyError:
            logger.exception("Tenant middleware DB error on path=%s host=%s", path, host)
            return JSONResponse({"detail": "Database unavailable"}, status_code=503)
        finally:
            # IMPORTANT: release DB connection before request handler runs
            # to avoid holding two sessions per request (middleware + endpoint).
            db.close()

        if tenant is None:
            if tenant_slug_header:
                return JSONResponse(
                    {
                        "detail": f"Tenant '{tenant_slug_header.lower()}' not found or inactive. Create/activate the tenant first."
                    },
                    status_code=400,
                )
            return JSONResponse(
                {
                    "detail": "Tenant not resolved. Provide X-Tenant-ID / X-Tenant-Slug or use a mapped domain."
                },
                status_code=400,
            )

        if not tenant.is_active:
            return JSONResponse({"detail": "Tenant is inactive."}, status_code=403)

        # Store lightweight immutable context object (detached from SQLAlchemy session).
        tenant_ctx = SimpleNamespace(
            id=tenant.id,
            slug=tenant.slug,
            name=tenant.name,
            is_active=tenant.is_active,
        )

        request.state.tenant = tenant_ctx
        request.state.tenant_id = tenant_ctx.id
        request.state.tenant_slug = tenant_ctx.slug

        # Update the logging context var so every log record emitted by the
        # route handler automatically includes the resolved tenant_id.
        log_tenant_id.set(str(tenant_ctx.id))

        return await call_next(request)
