# SaaS Super Admin Endpoints - Implementation Summary

## Overview

All backend endpoints for the SaaS super admin dashboard have been successfully implemented. The implementation follows the existing project patterns with Pydantic schemas, SQLAlchemy models, dependency injection, and proper API Router organization.

## Files Created/Modified

### 1. Database Migrations

#### `alambic/versions/e1f2g3h4i5j6_add_subscriptions_table.py`
- Creates the `subscriptions` table with all required columns
- Adds indexes for `tenant_id` and `status`
- Supports billing cycles (per_term, full_year) and subscription statuses

#### `alambic/versions/f2g3h4i5j6k7_add_category_to_permissions.py`
- Adds `category` column (VARCHAR 64, nullable) to permissions table
- Allows UI to override derived categories from permission codes

#### `alambic/versions/g3h4i5j6k7l8_seed_subscription_permissions.py`
- Seeds new permissions for subscription management
- Adds `subscriptions.read` and `subscriptions.manage` permissions
- Assigns them to SUPER_ADMIN role

### 2. SQLAlchemy Models

#### `app/models/subscription.py` (NEW)
```python
class Subscription(Base):
    - id: UUID (primary key)
    - tenant_id: UUID (foreign key to tenants)
    - plan: VARCHAR (Starter|Basic|Professional|Enterprise)
    - billing_cycle: VARCHAR (per_term|full_year)
    - status: VARCHAR (active|trialing|past_due|cancelled|paused)
    - amount_kes: NUMERIC(12,2)
    - discount_percent: NUMERIC(5,2)
    - period_start: DATE
    - period_end: DATE
    - notes: TEXT
    - created_at: TIMESTAMPTZ
    - updated_at: TIMESTAMPTZ
```

#### `app/models/rbac.py` (PATCHED)
- Added `category` column to Permission model (nullable VARCHAR 64)

### 3. Pydantic Schemas

#### `app/api/v1/admin/schemas.py` (EXTENDED)

**New Schemas:**
- `TenantRow`: Tenant response with user_count and plan metadata
- `CreateTenantRequest`: Request body for POST /tenants
- `RecentTenantRow`: Minimal tenant info with last_activity
- `RecentTenantsResponse`: List wrapper for recent tenants
- `SubscriptionRow`: Full subscription response with tenant info
- `CreateSubscriptionRequest`: Request body for POST /subscriptions
- `UpdateSubscriptionRequest`: Request body for PATCH /subscriptions
- `SaaSMetricsResponse`: Complete metrics response with revenue, subscriptions, tenants, system info
- `PermissionRow`: Permission response including category field

### 4. Service Layer

#### `app/api/v1/admin/service.py` (SIGNIFICANTLY EXTENDED)

**New Functions:**

1. `list_tenants_with_metadata(db, q=None, is_active=None)`
   - Lists all tenants with filtering by name/slug/domain
   - Includes user_count and active plan for each tenant

2. `create_tenant(db, name, slug, primary_domain, plan)`
   - Validates slug format (^[a-z0-9-]+$)
   - Creates tenant with optional subscription
   - Handles plan-based pricing

3. `get_recent_tenants(db, limit=6)`
   - Returns 6 most recently created tenants
   - Includes user_count, plan, and last_activity

4. `get_saas_metrics(db)`
   - Comprehensive SaaS dashboard metrics
   - Revenue: MRR, ARR, total_collected, growth_percent
   - Subscriptions: Active, trialing, past_due, cancelled counts; plans breakdown
   - Tenants: New this month, churned this month, total users
   - System: Total enrollments, invoices, audit events, permissions, roles

5. `list_subscriptions(db, status=None, plan=None, billing_cycle=None, tenant_id=None)`
   - Lists subscriptions with optional filters
   - Includes joined tenant_name and tenant_slug

6. `create_subscription(db, tenant_id, plan, billing_cycle, discount_percent, notes, period_start)`
   - Validates plan against PLAN_PRICES dict
   - Calculates amount_kes based on billing_cycle and discount
   - Sets status to "trialing" for first subscription, "active" otherwise
   - Calculates period_end (90 days for per_term, 365 for full_year)

7. `update_subscription(db, subscription_id, **kwargs)`
   - Partial update support for all fields
   - Recalculates amount_kes if plan/billing_cycle/discount changes
   - Preserves period_start/period_end (immutable)

8. `delete_subscription(db, subscription_id)`
   - Soft-cancel by setting status to "cancelled"

**Billing Constants:**
```python
PLAN_PRICES = {
    "Starter": 5_000,
    "Basic": 12_000,
    "Professional": 25_000,
    "Enterprise": 50_000,
}
```

### 5. API Routes

#### `app/api/v1/admin/routes.py` (EXTENDED WITH 6 NEW ENDPOINTS)

**1. PATCH - GET /api/v1/admin/tenants**
- Extended existing endpoint to include user_count and plan metadata
- Supports filtering by:
  - `q`: name, slug, or domain (case-insensitive ILIKE)
  - `is_active`: boolean filter for active/inactive tenants

**2. NEW - POST /api/v1/admin/tenants**
- Creates new tenant with validation
- Slug validation: must match ^[a-z0-9-]+$
- Slug uniqueness check (409 Conflict if duplicate)
- Optional subscription creation with plan
- TODO: admin_email for user creation + invitation

**3. NEW - GET /api/v1/admin/saas/metrics**
- Returns comprehensive SaaS dashboard KPIs
- 60-second cache using MetricsCache class
- Protected by `admin.dashboard.view_all` permission
- Includes revenue, subscriptions, tenants, and system metrics

**4. NEW - GET /api/v1/admin/saas/tenants/recent**
- Returns 6 most recently onboarded tenants
- Includes user_count, plan, and last_activity
- Ordered by created_at DESC

**5. NEW - GET /api/v1/admin/subscriptions**
- Lists all subscriptions with optional filters:
  - `status`: active|trialing|past_due|cancelled|paused
  - `plan`: string filter
  - `billing_cycle`: per_term|full_year
  - `tenant_id`: UUID filter

**6. NEW - POST /api/v1/admin/subscriptions**
- Creates subscription for a tenant
- Request:
  ```json
  {
    "tenant_id": "uuid",
    "plan": "Starter|Basic|Professional|Enterprise",
    "billing_cycle": "per_term|full_year",
    "discount_percent": 0.0,
    "notes": "optional",
    "period_start": "2026-02-23"
  }
  ```

**7. NEW - PATCH /api/v1/admin/subscriptions/{subscription_id}**
- Partial update of subscription
- All fields optional
- Recalculates pricing if plan/cycle/discount changes

**8. NEW - DELETE /api/v1/admin/subscriptions/{subscription_id}**
- Soft-cancel subscription
- Sets status to "cancelled"

**9. PATCH - GET /api/v1/admin/rbac/permissions**
- Extended response to include `category` field
- Allows UI to optionally override derived categories

**10. PATCH - PATCH /api/v1/admin/rbac/permissions/{code}**
- Extended to accept optional `category` field

### 6. Testing

#### `tests/test_admin_saas_endpoints.py` (NEW)
- Comprehensive pytest test suite with 15+ test cases
- Covers:
  - List tenants with filtering
  - Create tenant validation (slug format, uniqueness)
  - SaaS metrics calculation
  - Recent tenants retrieval
  - Subscription CRUD operations
  - Permission category field

**Test Classes:**
- `TestListTenants`: GET /tenants filtering
- `TestCreateTenant`: POST /tenants validation and creation
- `TestSaaSMetrics`: Metrics caching and calculation
- `TestRecentTenants`: Recent tenants retrieval
- `TestSubscriptions`: Full subscription CRUD lifecycle

## Critical Implementation Details

### Authentication & Authorization

All new endpoints require super admin authentication via:
- `require_permission_saas("tenants.read_all")` - read tenants
- `require_permission_saas("tenants.create")` - create tenants
- `require_permission_saas("admin.dashboard.view_all")` - view metrics
- `require_permission_saas("subscriptions.read")` - read subscriptions
- `require_permission_saas("subscriptions.manage")` - manage subscriptions

No tenant context resolution required for SaaS endpoints.

### Billing Logic

**Per Term (90 days):**
```
amount_kes = base_price * (1 - discount_percent / 100)
period_end = period_start + 90 days
```

**Full Year (365 days):**
```
amount_kes = base_price * 3 * (1 - discount_percent / 100)
period_end = period_start + 365 days
```

### Metrics Calculation

**MRR (Monthly Recurring Revenue):**
- per_term subs: amount_kes / 4
- full_year subs: amount_kes / 12

**ARR (Annual Recurring Revenue):**
- MRR * 12

**MoM Growth:**
```
((this_month_mrr - last_month_mrr) / last_month_mrr) * 100
```

### Caching

Metrics endpoint uses 60-second TTL cache to prevent expensive calculations on every request:
```python
class MetricsCache:
    - _cache: dict
    - _last_update: timestamp
    - _ttl: 60 seconds
```

## API Response Examples

### POST /api/v1/admin/tenants (201)
```json
{
  "id": "uuid",
  "slug": "test-school",
  "name": "Test School",
  "primary_domain": "test.example.com",
  "is_active": true,
  "plan": "Professional",
  "user_count": 0,
  "created_at": "2026-02-23T10:00:00Z",
  "updated_at": null
}
```

### GET /api/v1/admin/saas/metrics (200)
```json
{
  "revenue": {
    "mrr": 2500.0,
    "arr": 30000.0,
    "total_collected": 5000.0,
    "growth_percent": 25.5
  },
  "subscriptions": {
    "active": 3,
    "trialing": 1,
    "past_due": 0,
    "cancelled": 0,
    "plans": [
      {"name": "Starter", "count": 2, "price": 5000.0},
      {"name": "Professional", "count": 1, "price": 25000.0}
    ]
  },
  "tenants": {
    "new_this_month": 4,
    "churned_this_month": 1,
    "total_users_across_tenants": 45
  },
  "system": {
    "total_enrollments": 120,
    "total_invoices": 95,
    "total_audit_events": 3400,
    "total_permissions": 25,
    "total_roles": 5
  }
}
```

## Running Migrations

```bash
# Generate and run migrations
cd backend
alembic upgrade head

# Verify super admin permissions were seeded:
# - tenants.read_all
# - tenants.create
# - subscriptions.read
# - subscriptions.manage
# - admin.dashboard.view_all
```

## Running Tests

```bash
cd backend
pip install pytest pytest-asyncio
pytest tests/test_admin_saas_endpoints.py -v
```

## Next Steps (Optional Enhancements)

1. **Admin Email Invitation**: Implement email sending when `admin_email` is provided in POST /tenants
2. **Subscription Webhook**: Add webhook for subscription status changes (e.g., invoice overdue)
3. **Payment Integration**: Add actual payment processing endpoint
4. **Advanced Metrics**: Add cohort analysis, retention curves, etc.
5. **Audit Trails**: Log all admin actions for compliance

## Compliance with Requirements

✅ All 9 endpoints implemented (1 patched, 8 new)
✅ Proper Pydantic schema validation
✅ SQLAlchemy models and relationships
✅ Dependency injection for auth & database
✅ Super admin authentication required
✅ No tenant context on SaaS endpoints
✅ ISO 8601 datetime serialization
✅ Slug immutable after creation
✅ Comprehensive test suite
✅ Clean, typed Python code
✅ Follows existing project patterns
