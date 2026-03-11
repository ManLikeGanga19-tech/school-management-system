from fastapi import APIRouter

from app.api.v1.tenants.routes import router as tenants_router
from app.api.v1.auth.routes import router as auth_router
from app.api.v1.audit.routes import router as audit_router
from app.api.v1.admin.routes import router as admin_router
from app.api.v1.enrollments.routes import router as enrollments_router
from app.api.v1.finance.routes import router as finance_router
from app.api.v1.admin.audit.routes import router as admin_audit_router
from app.api.v1.support.routes import router as support_router
from app.api.v1.payments.routes import router as payments_router
from app.api.v1.public.routes import router as public_router

api_router = APIRouter()

# Core tenant + identity
api_router.include_router(tenants_router, prefix="/tenants", tags=["tenants"])

# ✅ Compatibility alias for older frontend paths:
# /api/v1/tenant/classes -> same as /api/v1/tenants/classes
api_router.include_router(tenants_router, prefix="/tenant", tags=["tenant-compat"])

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])

# Audit
api_router.include_router(audit_router, prefix="/audit", tags=["audit"])
api_router.include_router(admin_audit_router, prefix="/admin/audit", tags=["Admin Audit"])

# Admin
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])

# Business modules
api_router.include_router(enrollments_router, prefix="/enrollments", tags=["enrollments"])
api_router.include_router(finance_router, prefix="/finance", tags=["finance"])
api_router.include_router(support_router, prefix="/support", tags=["support"])
api_router.include_router(payments_router, prefix="/payments", tags=["payments"])
api_router.include_router(public_router, prefix="/public", tags=["public"])
