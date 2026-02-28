from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional, Literal
from uuid import UUID
from datetime import datetime, date


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
# Tenant Management
# -------------------------

class TenantUpdate(BaseModel):
    name: Optional[str] = None
    primary_domain: Optional[str] = None
    is_active: Optional[bool] = None


class TenantRow(BaseModel):
    """Tenant response schema with optional user_count and plan"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    slug: str
    name: str
    primary_domain: Optional[str] = None
    is_active: bool
    plan: Optional[str] = None
    user_count: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class TenantPrintProfileUpsert(BaseModel):
    logo_url: Optional[str] = Field(default=None, max_length=500)
    school_header: Optional[str] = Field(default=None, max_length=500)
    receipt_footer: Optional[str] = Field(default=None, max_length=500)
    paper_size: Literal["A4", "THERMAL_80MM"] = "A4"
    currency: str = Field(default="KES", min_length=3, max_length=10)
    thermal_width_mm: int = Field(default=80, ge=58, le=120)
    qr_enabled: bool = True


class TenantPrintProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tenant_id: UUID
    logo_url: Optional[str] = None
    school_header: Optional[str] = None
    receipt_footer: Optional[str] = None
    paper_size: Literal["A4", "THERMAL_80MM"]
    currency: str
    thermal_width_mm: int
    qr_enabled: bool
    updated_by: Optional[UUID] = None
    updated_at: Optional[datetime] = None


class CreateTenantRequest(BaseModel):
    """Request to create a new tenant"""
    name: str
    slug: str
    primary_domain: Optional[str] = None
    plan: Optional[str] = None  # "Starter"|"Basic"|"Professional"|"Enterprise"
    admin_email: Optional[str] = None


class RecentTenantRow(BaseModel):
    """Tenant row for recent tenants endpoint"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    name: str
    slug: str
    is_active: bool
    plan: Optional[str] = None
    user_count: Optional[int] = None
    created_at: datetime
    last_activity: Optional[datetime] = None


class RecentTenantsResponse(BaseModel):
    tenants: List[RecentTenantRow]


# -------------------------
# User Management
# -------------------------

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    full_name: Optional[str]
    is_active: bool


# -------------------------
# Subscription Management
# -------------------------

class SubscriptionRow(BaseModel):
    """Subscription response schema"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    tenant_id: UUID
    tenant_name: str
    tenant_slug: str
    plan: str
    billing_cycle: Literal["per_term", "full_year"]
    status: Literal["active","trialing","past_due","cancelled","paused"]
    amount_kes: float
    discount_percent: Optional[float] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    next_payment_date: Optional[date] = None
    next_payment_amount: Optional[float] = None
    created_at: datetime
    notes: Optional[str] = None


class CreateSubscriptionRequest(BaseModel):
    """Request to create a subscription"""
    tenant_id: UUID
    plan: str  # "Starter"|"Basic"|"Professional"|"Enterprise"
    billing_cycle: str  # "per_term" | "full_year"
    discount_percent: float = 0.0
    notes: Optional[str] = None
    period_start: Optional[date] = None


class UpdateSubscriptionRequest(BaseModel):
    """Request to update a subscription (all fields optional)"""
    plan: Optional[str] = None
    billing_cycle: Optional[str] = None
    status: Optional[str] = None  # "active"|"trialing"|"past_due"|"cancelled"|"paused"
    discount_percent: Optional[float] = None
    notes: Optional[str] = None


# -------------------------
# SaaS Metrics
# -------------------------

class RevenueMetrics(BaseModel):
    mrr: float
    arr: float
    total_collected: float
    growth_percent: float


class PlanMetric(BaseModel):
    name: str
    count: int
    price: float


class SubscriptionMetrics(BaseModel):
    active: int
    trialing: int
    past_due: int
    cancelled: int
    plans: List[PlanMetric]


class TenantMetrics(BaseModel):
    new_this_month: int
    churned_this_month: int
    total_users_across_tenants: int


class SystemMetrics(BaseModel):
    total_enrollments: int
    total_invoices: int
    total_audit_events: int
    total_permissions: int
    total_roles: int


class SaaSMetricsResponse(BaseModel):
    revenue: RevenueMetrics
    subscriptions: SubscriptionMetrics
    tenants: TenantMetrics
    system: SystemMetrics


# -------------------------
# Permission
# -------------------------

class PermissionRow(BaseModel):
    """Permission response schema with category"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    code: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    created_at: datetime


# -------------------------
# Additional Request Types
# -------------------------

class AssignRoleRequest(BaseModel):
    user_id: UUID
    role_code: str


class PermissionOverrideRequest(BaseModel):
    user_id: UUID
    permission_code: str
    effect: str  # "ALLOW" | "DENY"

