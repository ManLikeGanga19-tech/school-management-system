from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.middleware import TenantMiddleware
from app.core.middleware_audit import AuditMiddleware
from app.core.database import engine

app = FastAPI(title="School Management System API")

# Inner middlewares
app.add_middleware(TenantMiddleware)
app.add_middleware(AuditMiddleware)

# CORS outermost
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    # Lightweight readiness check that validates DB connectivity.
    with engine.connect() as conn:
        conn.exec_driver_sql("SELECT 1")
    return {"status": "ready"}
