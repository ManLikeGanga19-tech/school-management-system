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
    slug: Optional[str] = None
    primary_domain: Optional[str] = None
    is_active: Optional[bool] = None
    admin_email: Optional[str] = None
    admin_full_name: Optional[str] = None
    admin_password: Optional[str] = Field(default=None, min_length=8, max_length=128)


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
    admin_user_id: Optional[UUID] = None
    admin_email: Optional[str] = None
    admin_full_name: Optional[str] = None
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
    plan: Optional[Literal["per_term", "per_year"]] = None
    admin_email: Optional[str] = None
    admin_full_name: Optional[str] = None
    admin_password: Optional[str] = Field(default=None, min_length=8, max_length=128)


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
    billing_plan: Literal["per_term", "per_year"]
    # Backward-compatible fields for existing clients.
    plan: Optional[str] = None
    billing_cycle: Optional[Literal["per_term", "full_year"]] = None
    status: Literal["active","trialing","past_due","cancelled","paused"]
    amount_kes: float
    discount_percent: Optional[float] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    next_payment_date: Optional[date] = None
    next_payment_amount: Optional[float] = None
    billing_term_label: Optional[str] = None
    billing_term_code: Optional[str] = None
    billing_academic_year: Optional[int] = None
    created_at: datetime
    notes: Optional[str] = None


class SubscriptionBillingEligibilityResponse(BaseModel):
    billing_plan: Literal["per_term", "per_year"]
    source: Literal["saas_academic_calendar", "fallback"]
    as_of: date
    academic_year: int
    label: str
    eligible_from_date: date
    eligible_until_date: date
    term_no: Optional[int] = None
    term_code: Optional[str] = None
    term_name: Optional[str] = None


class CreateSubscriptionRequest(BaseModel):
    """Request to create a subscription"""
    tenant_id: UUID
    billing_plan: Literal["per_term", "per_year"]
    amount_kes: float = Field(..., gt=0)
    discount_percent: float = Field(default=0.0, ge=0, le=100)
    notes: Optional[str] = None
    period_start: Optional[date] = None


class UpdateSubscriptionRequest(BaseModel):
    """Request to update a subscription (all fields optional)"""
    billing_plan: Optional[Literal["per_term", "per_year"]] = None
    amount_kes: Optional[float] = Field(default=None, gt=0)
    status: Optional[Literal["active", "trialing", "past_due", "cancelled", "paused"]] = None
    discount_percent: Optional[float] = Field(default=None, ge=0, le=100)
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


class DarajaPaymentsHealthResponse(BaseModel):
    status: Literal["ready", "degraded"]
    ready: bool
    mode: Literal["sandbox", "production"]
    use_mock: bool
    sandbox_fallback_to_mock: bool
    timeout_sec: int
    callback_url: Optional[str] = None
    callback_token_protected: bool
    missing_required: List[str] = Field(default_factory=list)
    checked_at: datetime


class DarajaDnsCheckResult(BaseModel):
    host: str
    ok: bool
    addresses: List[str] = Field(default_factory=list)
    latency_ms: Optional[int] = None
    error: Optional[str] = None


class DarajaOauthCheckResult(BaseModel):
    attempted: bool
    ok: bool
    latency_ms: Optional[int] = None
    error_type: Optional[str] = None
    error: Optional[str] = None


class DarajaConnectivityCheckResponse(BaseModel):
    status: Literal["healthy", "degraded", "misconfigured"]
    mode: Literal["sandbox", "production"]
    base_url: str
    use_mock: bool
    sandbox_fallback_to_mock: bool
    missing_required: List[str] = Field(default_factory=list)
    dns_checks: List[DarajaDnsCheckResult] = Field(default_factory=list)
    oauth_check: DarajaOauthCheckResult
    recommendation: str
    checked_at: datetime


# -------------------------
# SaaS Payments
# -------------------------

class SaaSPaymentHistoryRow(BaseModel):
    id: UUID
    tenant_id: UUID
    tenant_name: str
    tenant_slug: str
    subscription_id: Optional[UUID] = None
    checkout_request_id: str
    amount_kes: float
    status: Literal["pending", "completed", "failed", "cancelled"]
    phone_number: Optional[str] = None
    mpesa_receipt: Optional[str] = None
    billing_plan: Literal["per_term", "per_year"]
    billing_term_label: Optional[str] = None
    paid_at: Optional[datetime] = None
    created_at: datetime


class SaaSPaymentHistoryResponse(BaseModel):
    total: int
    items: List[SaaSPaymentHistoryRow]


# -------------------------
# SaaS Academic Calendar
# -------------------------

class SaaSAcademicCalendarTerm(BaseModel):
    term_no: int = Field(..., ge=1, le=3)
    term_code: str
    term_name: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: bool = True
    updated_at: Optional[datetime] = None


class SaaSAcademicCalendarResponse(BaseModel):
    academic_year: int
    terms: List[SaaSAcademicCalendarTerm]


class SaaSAcademicCalendarTermUpsert(BaseModel):
    term_no: int = Field(..., ge=1, le=3)
    term_code: Optional[str] = Field(default=None, max_length=64)
    term_name: Optional[str] = Field(default=None, max_length=160)
    start_date: date
    end_date: date
    is_active: bool = True


class SaaSAcademicCalendarUpsertRequest(BaseModel):
    academic_year: int = Field(..., ge=2000, le=2100)
    terms: List[SaaSAcademicCalendarTermUpsert] = Field(..., min_length=1, max_length=3)


class SaaSAcademicCalendarApplyRequest(BaseModel):
    academic_year: int = Field(..., ge=2000, le=2100)
    tenant_ids: Optional[List[UUID]] = None
    only_missing: bool = True


class SaaSAcademicCalendarApplyResponse(BaseModel):
    academic_year: int
    tenants_targeted: int
    affected_terms: int
    created_terms: int
    updated_terms: int
    skipped_terms: int


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
