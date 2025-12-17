

with tenant as (
  select id
  from core.tenants
  where slug = 'novel-junior-school'
)

-- Create default roles
insert into core.roles (tenant_id, name, description, is_system)
select
  tenant.id,
  r.name,
  r.description,
  true
from tenant
cross join (
  values
    ('Director',  'Full oversight & approvals'),
    ('Secretary', 'Operations & finance recording'),
    ('Teacher',   'Academics scoped to assigned classes'),
    ('Parent',    'Portal access to own children')
) as r(name, description)
on conflict (tenant_id, name) do nothing;


-- Director → ALL permissions
with tenant as (
  select id from core.tenants where slug = 'novel-junior-school'
),
director as (
  select r.id
  from core.roles r
  join tenant t on t.id = r.tenant_id
  where r.name = 'Director'
)
insert into core.role_permissions (role_id, permission_id)
select d.id, p.id
from director d
cross join core.permissions p
on conflict do nothing;


-- Secretary permissions
with tenant as (
  select id from core.tenants where slug = 'novel-junior-school'
),
secretary as (
  select r.id
  from core.roles r
  join tenant t on t.id = r.tenant_id
  where r.name = 'Secretary'
)
insert into core.role_permissions (role_id, permission_id)
select s.id, p.id
from secretary s
join core.permissions p on p.code in (
  'tenant.profile.read',
  'iam.users.read',

  'students.profile.read',
  'students.profile.create',
  'students.profile.update',
  'students.profile.archive',
  'students.photo.upload',

  'parents.profile.read',
  'staff.profile.read',

  'structure.read',
  'structure.manage',

  'enrollment.read',
  'enrollment.manage',

  'fees.invoice.read',
  'fees.invoice.issue',
  'fees.payment.record',
  'fees.receipt.issue',
  'fees.receipt.void.request'
)
on conflict do nothing;


-- Teacher permissions
with tenant as (
  select id from core.tenants where slug = 'novel-junior-school'
),
teacher as (
  select r.id
  from core.roles r
  join tenant t on t.id = r.tenant_id
  where r.name = 'Teacher'
)
insert into core.role_permissions (role_id, permission_id)
select t.id, p.id
from teacher t
join core.permissions p on p.code in (
  'tenant.profile.read',

  'structure.read',

  'students.profile.read',
  'enrollment.read',

  'attendance.read',
  'attendance.mark',
  'attendance.edit',

  'academics.assessments.read',
  'academics.assessments.manage',

  'academics.results.read',
  'academics.results.edit'
)
on conflict do nothing;


-- Parent permissions
with tenant as (
  select id from core.tenants where slug = 'novel-junior-school'
),
parent as (
  select r.id
  from core.roles r
  join tenant t on t.id = r.tenant_id
  where r.name = 'Parent'
)
insert into core.role_permissions (role_id, permission_id)
select pr.id, p.id
from parent pr
join core.permissions p on p.code in (
  'tenant.profile.read',

  'students.profile.read',
  'enrollment.read',
  'attendance.read',

  'academics.results.read',

  'fees.invoice.read'
)
on conflict do nothing;
