import time
import uuid
import logging
import asyncio
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.database import SessionLocal
from app.core.audit import log_event

logger = logging.getLogger(__name__)


async def _bg_audit_log(tenant_id, actor_user_id, meta):
    """Run audit log write in background thread to avoid blocking request lifecycle.

    This uses a thread to perform blocking DB IO so the ASGI worker can continue
    serializing the response and freeing request-scoped resources.
    """
    try:
        def _write():
            db = SessionLocal()
            try:
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

        await asyncio.to_thread(_write)
    except Exception:
        logger.exception("Background audit log failed")


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()

        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id

        response: Response | None = None
        err: Exception | None = None
        try:
            response = await call_next(request)
        except Exception as exc:
            err = exc
            response = Response(status_code=500)

        duration_ms = int((time.time() - start) * 1000)

        tenant_id = getattr(request.state, "tenant_id", None)
        actor_user_id = getattr(request.state, "user_id", None)

        if tenant_id:
            meta = {
                "request_id": request_id,
                "method": request.method,
                "path": str(request.url.path),
                "status_code": response.status_code if response else 500,
                "duration_ms": duration_ms,
                "ip": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent"),
            }
            if err:
                meta["error"] = err.__class__.__name__
                meta["error_message"] = str(err)[:500]

            # schedule background write and do not await — prevents holding DB
            # connections during response serialization. Errors are logged.
            try:
                asyncio.create_task(_bg_audit_log(tenant_id, actor_user_id, meta))
            except Exception:
                logger.exception("Failed to schedule background audit log")

        if response is not None:
            response.headers["X-Request-ID"] = request_id

        if err:
            logger.exception("Unhandled request error (%s)", request_id, exc_info=err)
            raise err

        return response
