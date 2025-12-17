from fastapi import FastAPI
from app.api.v1.router import api_router
from app.core.middleware import TenantMiddleware

app = FastAPI(title="School Management System API")

app.add_middleware(TenantMiddleware)

app.include_router(api_router, prefix="/api/v1")
