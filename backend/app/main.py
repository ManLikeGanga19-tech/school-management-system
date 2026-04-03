import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging_config import configure_logging

# Configure logging as early as possible — before any module-level loggers fire.
# Uses JSON in all non-dev environments (staging, ci, production).
configure_logging(app_env=os.environ.get("APP_ENV", "dev"))
from app.core.database import database_status, engine
from app.core.middleware import TenantMiddleware
from app.core.middleware_audit import AuditMiddleware
from app.core.middleware_request_id import RequestIDMiddleware
from app.core.middleware_security import SecurityHeadersMiddleware
from app.core.audit import prune_audit_logs
from app.core.database import SessionLocal
from app.core.middleware_audit import shutdown_audit_queue
from app.core.rate_limit import limiter
from app.core.redis import close_redis, init_redis

logger = logging.getLogger(__name__)

# ── Body size limit ────────────────────────────────────────────────────────────
# Belt-and-suspenders: Nginx enforces client_max_body_size 25m at the edge.
# This middleware provides an application-level guard (2 MB for JSON API calls)
# so the limit holds even if the backend is reached directly (bypassing Nginx)
# or if content-length is reported by a trusted proxy.
_MAX_BODY_BYTES = 2 * 1024 * 1024  # 2 MB


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip size enforcement for multipart file uploads (handled per-endpoint)
        ct = request.headers.get("content-type", "")
        if ct.startswith("multipart/form-data"):
            return await call_next(request)

        cl = request.headers.get("content-length")
        if cl is not None:
            try:
                if int(cl) > _MAX_BODY_BYTES:
                    return JSONResponse(
                        {"detail": f"Request body too large (max {_MAX_BODY_BYTES // 1024} KB)."},
                        status_code=413,
                    )
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length header."}, status_code=400)
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──────────────────────────────────────────────────────────────
    ready, reason = database_status()
    if not ready:
        logger.error("Application started with unhealthy database: %s", reason)

    await init_redis()

    # ── Audit log pruning ─────────────────────────────────────────────────────
    # Run once at startup so the table stays bounded without a separate cron.
    # Offloaded to a thread to avoid blocking the async event loop.
    _retention = settings.AUDIT_LOG_RETENTION_DAYS
    if _retention > 0:
        def _prune():
            with SessionLocal() as db:
                return prune_audit_logs(db, retention_days=_retention)
        try:
            _pruned = await asyncio.to_thread(_prune)
            if _pruned:
                logger.info(
                    "Audit log pruning: removed %d rows older than %d days",
                    _pruned,
                    _retention,
                )
        except Exception:
            logger.warning("Audit log pruning failed — will retry on next startup", exc_info=True)

    # ── CORS configuration sanity check ──────────────────────────────────────
    _cors_origins = settings.cors_origins_list
    _cors_regex = settings.cors_origin_regex
    if not _cors_origins and not _cors_regex:
        logger.warning(
            "CORS: No allowed origins or subdomain regex configured. "
            "All cross-origin browser requests will be blocked. "
            "Set CORS_ORIGINS and/or CORS_BASE_DOMAIN."
        )
    else:
        logger.info(
            "CORS: exact_origins=%s | subdomain_regex=%s",
            _cors_origins,
            _cors_regex or "(none — set CORS_BASE_DOMAIN=shulehq.co.ke to enable)",
        )

    # ── PostgreSQL SSL mode ───────────────────────────────────────────────────
    _ssl_mode = str(settings.DB_SSL_MODE or "").strip()
    if not _ssl_mode and settings.APP_ENV != "dev":
        logger.warning(
            "DATABASE: DB_SSL_MODE is not set. "
            "Connections to managed PostgreSQL (RDS/Supabase/Railway) will be "
            "unencrypted. Set DB_SSL_MODE=require in your production .env."
        )
    elif _ssl_mode:
        logger.info("DATABASE: SSL mode=%s", _ssl_mode)

    # Warn loudly if Daraja callback token is unset outside dev.
    # An unconfigured token means ANY caller can post fake payment callbacks.
    if settings.APP_ENV != "dev" and not str(settings.DARAJA_CALLBACK_TOKEN or "").strip():
        logger.warning(
            "SECURITY: DARAJA_CALLBACK_TOKEN is not set. "
            "The /payments/daraja/callback endpoint is unprotected. "
            "Set DARAJA_CALLBACK_TOKEN in your production .env to prevent spoofed callbacks."
        )

    yield

    # ── shutdown ─────────────────────────────────────────────────────────────
    # Drain audit queue first — workers need the DB pool and Redis to flush
    # remaining events. Close infrastructure connections only after drain.
    await shutdown_audit_queue()
    await close_redis()


# ── OpenAPI docs ───────────────────────────────────────────────────────────────
# Expose interactive docs only in dev. In staging/production the schema is
# compiled into the frontend and there is no reason to publish the full API
# surface publicly. Set APP_ENV=dev to re-enable locally.
_is_dev = settings.APP_ENV == "dev"

app = FastAPI(
    title="School Management System API",
    lifespan=lifespan,
    docs_url="/docs" if _is_dev else None,
    redoc_url="/redoc" if _is_dev else None,
    openapi_url="/openapi.json" if _is_dev else None,
)

# ── Rate limiter ──────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Middleware stack ───────────────────────────────────────────────────────────
# add_middleware inserts at position 0 (outermost), so last-added runs first.
# Execution order on incoming requests:
#   RequestID → SecurityHeaders → Audit → Tenant → route handler
#
app.add_middleware(TenantMiddleware)          # innermost: resolves tenant context
app.add_middleware(AuditMiddleware)           # audit logging + X-Request-ID echo
app.add_middleware(SecurityHeadersMiddleware) # security headers on all responses
app.add_middleware(RequestSizeLimitMiddleware) # reject oversized bodies early
app.add_middleware(RequestIDMiddleware)       # ensure X-Request-ID set at the edge
app.add_middleware(                           # outermost: CORS
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    # allow_origin_regex handles tenant subdomains (e.g. greenhill.shulehq.co.ke).
    # The regex enforces HTTPS — HTTP subdomain origins are explicitly rejected.
    # Starlette echoes back the matched origin (never "*"), so allow_credentials
    # continues to work correctly with session cookies.
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    # Explicit method list — reject TRACE/CONNECT and other unused verbs.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    # Explicit header allowlist — reject arbitrary custom headers not part of the API.
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Tenant-ID",
        "X-Tenant-Slug",
        "X-Request-ID",
    ],
    # Expose X-Request-ID so the frontend can surface correlation IDs in error UIs.
    expose_headers=["X-Request-ID"],
    # Cache preflight responses for 10 minutes to reduce OPTIONS request overhead.
    max_age=600,
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    ready, reason = database_status()
    if not ready:
        raise HTTPException(status_code=503, detail=f"Database not ready: {reason}")
    with engine.connect() as conn:
        conn.exec_driver_sql("SELECT 1")
    return {"status": "ready"}
