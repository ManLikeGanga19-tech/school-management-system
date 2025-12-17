from fastapi import APIRouter
from app.api.v1.tenants.routes import router as tenants_router
from app.api.v1.auth.routes import router as auth_router

api_router = APIRouter()

api_router.include_router(tenants_router, prefix="/tenants", tags=["tenants"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
