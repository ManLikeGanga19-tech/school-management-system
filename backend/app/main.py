from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.middleware import TenantMiddleware
from app.core.middleware_audit import AuditMiddleware

app = FastAPI(title="School Management System API")

# Your middlewares (inner)
app.add_middleware(TenantMiddleware)
app.add_middleware(AuditMiddleware)

# ✅ CORS MUST BE LAST so it runs FIRST (outermost)
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
