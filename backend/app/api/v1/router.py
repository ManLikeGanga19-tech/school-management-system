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
from app.api.v1.students.routes import router as students_router
from app.api.v1.attendance.routes import router as attendance_router
from app.api.v1.reports.routes import router as reports_router
from app.api.v1.cbc.routes import router as cbc_router
from app.api.v1.igcse.routes import router as igcse_router
from app.api.v1.discipline.routes import router as discipline_router
from app.api.v1.discipline.routes import students_router as discipline_students_router
from app.api.v1.sms.routes import router as sms_router
from app.api.v1.sms.routes import admin_router as sms_admin_router
from app.api.v1.hr.routes import router as hr_router

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

# SIS
api_router.include_router(students_router, prefix="/students", tags=["students"])

# Attendance
api_router.include_router(attendance_router, prefix="/attendance", tags=["attendance"])

# Reports (8-4-4 Report Cards)
api_router.include_router(reports_router, prefix="/reports", tags=["reports"])

# CBC Assessments (Phase 3B)
api_router.include_router(cbc_router, prefix="/cbc", tags=["cbc"])

# IGCSE Assessments
api_router.include_router(igcse_router, prefix="/igcse", tags=["igcse"])

# Discipline (Phase 4)
api_router.include_router(discipline_router, prefix="/discipline", tags=["discipline"])
api_router.include_router(discipline_students_router, prefix="/students", tags=["students"])

# SMS Communications (Phase 5)
api_router.include_router(sms_router, prefix="/sms", tags=["sms"])
api_router.include_router(sms_admin_router, prefix="/admin/sms", tags=["admin-sms"])

# HR Module (Phase 6) — leave, payroll, SMS recipients
api_router.include_router(hr_router, prefix="/tenants", tags=["hr"])
api_router.include_router(hr_router, prefix="/tenant", tags=["hr-compat"])
