from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.database import SessionLocal
from app.core.tenant import resolve_tenant_from_host


class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        host = request.headers.get("host")

        if not host:
            return await call_next(request)

        db = SessionLocal()
        try:
            tenant = resolve_tenant_from_host(db, host)
            request.state.tenant = tenant
        finally:
            db.close()

        return await call_next(request)
