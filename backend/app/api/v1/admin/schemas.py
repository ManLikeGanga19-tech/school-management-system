from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from uuid import UUID


# -------------------------
# Dashboard Schemas
# -------------------------

class TenantSummary(BaseModel):
    tenant_id: UUID
    name: str
    slug: str
    is_active: bool


class SaaSSummary(BaseModel):
    total_tenants: int
    active_tenants: int
    inactive_tenants: int


class TenantDashboardSummary(BaseModel):
    total_users: int
    total_roles: int
    total_audit_logs: int


# -------------------------
# Tenant Update
# -------------------------

class TenantUpdate(BaseModel):
    name: Optional[str] = None
    primary_domain: Optional[str] = None
    is_active: Optional[bool] = None


# -------------------------
# User Management
# -------------------------

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    full_name: Optional[str]
    is_active: bool


class AssignRoleRequest(BaseModel):
    user_id: UUID
    role_code: str


class PermissionOverrideRequest(BaseModel):
    user_id: UUID
    permission_code: str
    effect: str  # "ALLOW" | "DENY"
