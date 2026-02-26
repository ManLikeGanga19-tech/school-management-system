# Quick Start Guide - SaaS Admin Endpoints

## Setup & Migration

```bash
cd backend

# Apply all migrations (creates subscriptions table, adds category column)
alembic upgrade head

# Verify migration worked
# You should see subscriptions table in public schema and category column in permissions table
```

## Pre-requisites

Ensure these permissions exist in your database (should be auto-seeded):
- `admin.dashboard.view_all`
- `tenants.read_all`
- `tenants.create`
- `subscriptions.read`
- `subscriptions.manage`

Ensure SUPER_ADMIN role has these permissions assigned.

## API Endpoint Reference

### 1. List Tenants (with metadata)
```bash
curl -X GET "http://localhost:8000/api/v1/admin/tenants" \
  -H "Authorization: Bearer <SAAS_TOKEN>" \
  -H "X-Tenant-ID: __saas__"

# With filters:
curl -X GET "http://localhost:8000/api/v1/admin/tenants?q=nairobi&is_active=true" \
  -H "Authorization: Bearer <SAAS_TOKEN>"
```

### 2. Create Tenant
```bash
curl -X POST "http://localhost:8000/api/v1/admin/tenants" \
  -H "Authorization: Bearer <SAAS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Nairobi Academy",
    "slug": "nairobi-academy",
    "primary_domain": "nbi.academy.com",
    "plan": "Professional"
  }'
```

### 3. Get SaaS Metrics
```bash
curl -X GET "http://localhost:8000/api/v1/admin/saas/metrics" \
  -H "Authorization: Bearer <SAAS_TOKEN>"
```

### 4. Get Recent Tenants
```bash
curl -X GET "http://localhost:8000/api/v1/admin/saas/tenants/recent" \
  -H "Authorization: Bearer <SAAS_TOKEN>"
```

### 5. List Subscriptions
```bash
curl -X GET "http://localhost:8000/api/v1/admin/subscriptions" \
  -H "Authorization: Bearer <SAAS_TOKEN>"

# With filters:
curl -X GET "http://localhost:8000/api/v1/admin/subscriptions?status=active&plan=Professional" \
  -H "Authorization: Bearer <SAAS_TOKEN>"
```

### 6. Create Subscription
```bash
curl -X POST "http://localhost:8000/api/v1/admin/subscriptions" \
  -H "Authorization: Bearer <SAAS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
    "plan": "Professional",
    "billing_cycle": "per_term",
    "discount_percent": 10.0,
    "notes": "Q2 2026 subscription"
  }'
```

### 7. Update Subscription
```bash
curl -X PATCH "http://localhost:8000/api/v1/admin/subscriptions/{sub_id}" \
  -H "Authorization: Bearer <SAAS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "active",
    "plan": "Enterprise"
  }'
```

### 8. Cancel Subscription
```bash
curl -X DELETE "http://localhost:8000/api/v1/admin/subscriptions/{sub_id}" \
  -H "Authorization: Bearer <SAAS_TOKEN>"
```

### 9. List Permissions (with category)
```bash
curl -X GET "http://localhost:8000/api/v1/admin/rbac/permissions" \
  -H "Authorization: Bearer <SAAS_TOKEN>"
```

## Testing

### Run Test Suite
```bash
cd backend
pip install pytest pytest-asyncio
pytest tests/test_admin_saas_endpoints.py -v

# Run specific test class
pytest tests/test_admin_saas_endpoints.py::TestListTenants -v

# Run with coverage
pytest tests/test_admin_saas_endpoints.py --cov=app.api.v1.admin
```

### Example Test Output
```
tests/test_admin_saas_endpoints.py::TestListTenants::test_list_tenants_empty PASSED
tests/test_admin_saas_endpoints.py::TestListTenants::test_list_tenants_filter_by_name PASSED
tests/test_admin_saas_endpoints.py::TestCreateTenant::test_create_tenant_minimal PASSED
tests/test_admin_saas_endpoints.py::TestCreateTenant::test_create_tenant_invalid_slug PASSED
tests/test_admin_saas_endpoints.py::TestSubscriptions::test_create_subscription PASSED
```

## Billing Price Reference

```python
Per Term (90 days):
- Starter:      5,000 KES
- Basic:       12,000 KES
- Professional: 25,000 KES
- Enterprise:   50,000 KES

Full Year (365 days):
- Starter:      15,000 KES (5k × 3)
- Basic:       36,000 KES (12k × 3)
- Professional: 75,000 KES (25k × 3)
- Enterprise:  150,000 KES (50k × 3)

With discount applied to base amount:
amount_kes = base_price × (1 - discount_percent / 100) × [1 for per_term, 3 for full_year]
```

## Troubleshooting

### 1. "Permission not found" error
- Ensure super admin user has SaaS role assigned
- Check that SUPER_ADMIN role has required permissions
- Verify token includes correct permissions and tenant_id=__saas__

### 2. "Slug already exists"
- Choose a unique slug (check existing tenants first)
- Slugs must be lowercase with hyphens only
- Example valid slugs: `test-school`, `acme-academy-2026`, `school-123`

### 3. "Tenant not found" when creating subscription
- Verify tenant exists by calling GET /tenants
- Use the exact UUID from tenant creation response

### 4. Metrics showing as 0
- Ensure subscriptions exist with status='active'
- Check that tenants have users assigned
- Verify period_start and period_end are set correctly

### 5. Cache not working
- Metrics are cached for 60 seconds
- Call endpoint twice within 60 seconds to verify cache
- Clear cache by waiting >60 seconds or restarting server

## Performance Notes

- Metrics endpoint is cached for 60 seconds to avoid expensive calculations
- Subscriptions list can be filtered by tenant_id to reduce query scope
- Consider adding pagination for large tenant lists (future enhancement)
- Audit log queries may be slow with millions of events

## Security Checklist

- ✅ All SaaS endpoints protected by `require_permission_saas()`
- ✅ No tenant context resolved on SaaS routes
- ✅ Slug validation prevents injection attacks
- ✅ UUID parameters type-checked by Pydantic
- ✅ All monetary values use Decimal type (no floating point)
- ✅ Soft-deletes preserve audit trail
- ✅ Updated timestamps tracked on all entities

## Database Schema

### subscriptions table
```sql
CREATE TABLE core.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  plan VARCHAR(64) NOT NULL,
  billing_cycle VARCHAR(16) NOT NULL CHECK (billing_cycle IN ('per_term', 'full_year')),
  status VARCHAR(16) NOT NULL DEFAULT 'trialing' CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'paused')),
  amount_kes NUMERIC(12,2) NOT NULL,
  discount_percent NUMERIC(5,2) DEFAULT 0.0,
  period_start DATE,
  period_end DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX idx_subscriptions_tenant_id ON core.subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON core.subscriptions(status);
```

### permissions table changes
```sql
ALTER TABLE core.permissions ADD COLUMN category VARCHAR(64);
```

## Support & Documentation

- Full API documentation: See IMPLEMENTATION_SUMMARY.md
- File structure: See FILES_AND_CHANGES.md
- Test examples: See tests/test_admin_saas_endpoints.py
