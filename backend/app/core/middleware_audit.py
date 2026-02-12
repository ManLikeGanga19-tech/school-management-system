import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.database import SessionLocal
from app.core.audit import log_event


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()

        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id

        response: Response
        try:
            response = await call_next(request)
        except Exception:
            # If your system already has error handlers, you can still log 500s here.
            response = Response("Internal Server Error", status_code=500)

        duration_ms = int((time.time() - start) * 1000)

        # Tenant + actor should be set by your existing tenant resolver + auth dependency
        tenant_id = getattr(request.state, "tenant_id", None)
        actor_user_id = getattr(request.state, "user_id", None)

        # Only log if tenant exists (multi-tenant safety)
        if tenant_id:
            db = SessionLocal()
            try:
                meta = {
                    "request_id": request_id,
                    "method": request.method,
                    "path": str(request.url.path),
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                    "ip": request.client.host if request.client else None,
                    "user_agent": request.headers.get("user-agent"),
                }
                log_event(
                    db,
                    tenant_id=tenant_id,
                    actor_user_id=actor_user_id,
                    action="http.request",
                    resource="http",
                    resource_id=None,
                    payload=None,
                    meta=meta,
                )
                db.commit()
            finally:
                db.close()

        response.headers["X-Request-ID"] = request_id
        return response
