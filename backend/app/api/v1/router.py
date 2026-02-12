from fastapi import APIRouter
from app.api.v1.tenants.routes import router as tenants_router
from app.api.v1.auth.routes import router as auth_router
# from app.api.v1.audit.routes import router as audit_router
from app.api.v1.admin.routes import router as admin_router
# from app.api.v1.enrollments.routes import router as enrollments_router

api_router = APIRouter()

api_router.include_router(tenants_router, prefix="/tenants", tags=["tenants"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
# api_router.include_router(audit_router, prefix="/audit", tags=["audit"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
# api_router.include_router(enrollments_router, prefix="/enrollments", tags=["enrollments"])