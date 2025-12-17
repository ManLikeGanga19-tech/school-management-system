with tenant as (
  select id
  from core.tenants
  where slug = 'novel-junior-school'
),


user_upsert as (
  insert into core.users (
    email,
    password_hash,
    full_name,
    is_active
  )
  values (
    'daniel.orwenjo@noveljuniorschool.ac.ke',
    '$2b$12$PLACEHOLDER_HASH_REPLACE_LATER',
    'Daniel Orwenjo',
    true
  )
  on conflict (email) do update
    set
      full_name = excluded.full_name,
      is_active = true,
      updated_at = now()
  returning id
),

-- Attach user to tenant
user_tenant as (
  insert into core.user_tenants (
    tenant_id,
    user_id,
    is_active
  )
  select
    tenant.id,
    user_upsert.id,
    true
  from tenant, user_upsert
  on conflict (tenant_id, user_id) do nothing
  returning tenant_id, user_id
)

-- Assign Director role
insert into core.user_roles (
  tenant_id,
  user_id,
  role_id
)
select
  ut.tenant_id,
  ut.user_id,
  r.id
from user_tenant ut
join core.roles r
  on r.tenant_id = ut.tenant_id
 and r.name = 'Director'
on conflict do nothing;
