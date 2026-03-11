import logging

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.middleware import TenantMiddleware
from app.core.middleware_audit import AuditMiddleware
from app.core.database import database_status, engine

logger = logging.getLogger(__name__)

app = FastAPI(title="School Management System API")

# Inner middlewares
app.add_middleware(TenantMiddleware)
app.add_middleware(AuditMiddleware)

# CORS outermost
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
def log_database_bootstrap_state():
    ready, reason = database_status()
    if not ready:
        logger.error("Application started with database status=%s", reason)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    # Lightweight readiness check that validates DB connectivity.
    ready, reason = database_status()
    if not ready:
        raise HTTPException(status_code=503, detail=f"Database not ready: {reason}")
    with engine.connect() as conn:
        conn.exec_driver_sql("SELECT 1")
    return {"status": "ready"}
