from fastapi import FastAPI
from app.api.v1.router import api_router
from app.core.middleware import TenantMiddleware
from app.core.middleware_audit import AuditMiddleware

app = FastAPI(title="School Management System API")

app.add_middleware(TenantMiddleware)
app.add_middleware(AuditMiddleware)

app.include_router(api_router, prefix="/api/v1")
