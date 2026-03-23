import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging_config import log_request_id, log_tenant_id


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Guarantees every request has a correlation ID before any other middleware
    or route handler runs.

    - Honours an X-Request-ID header forwarded by Nginx (generated at the edge).
    - Generates a fresh UUID4 when none is present.
    - Stores the ID in request.state.request_id for downstream middleware,
      dependency injectors, and route handlers.
    - Echoes the ID in the response header so callers can correlate logs.
    - Sets log_request_id / log_tenant_id context vars so every log record
      emitted during this request automatically carries correlation fields
      without callers passing them explicitly.

    Running this as the outermost middleware (added last via add_middleware)
    ensures the ID is present even on responses that short-circuit inside
    inner middleware (e.g., TenantMiddleware 400s, CORS rejections).
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id

        # Bind context vars for structured logging — reset on each request so
        # context from a previous request never leaks into the current one.
        req_token = log_request_id.set(request_id)
        ten_token = log_tenant_id.set(None)  # TenantMiddleware updates this later
        try:
            response: Response = await call_next(request)
        finally:
            log_request_id.reset(req_token)
            log_tenant_id.reset(ten_token)

        response.headers["X-Request-ID"] = request_id
        return response
