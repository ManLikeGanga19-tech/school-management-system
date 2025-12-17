
insert into core.roles (tenant_id, name, description, is_system)
values
(:TENANT_ID, 'Director', 'Full oversight & approvals', true),
(:TENANT_ID, 'Secretary', 'Operations & finance recording', true),
(:TENANT_ID, 'Teacher', 'Academics scoped to assigned classes', true),
(:TENANT_ID, 'Parent', 'Portal access to own children', true)
on conflict (tenant_id, name) do nothing;

-- Helper: map permissions to roles
-- Director: everything in v1
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on true
where r.tenant_id = :TENANT_ID and r.name = 'Director'
on conflict do nothing;

-- Secretary: operations + fees + student management + limited reads
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.code in (
  'tenant.profile.read',
  'iam.users.read',

  'students.profile.read','students.profile.create','students.profile.update','students.profile.archive','students.photo.upload',
  'parents.profile.read','staff.profile.read',
  'structure.read','structure.manage',
  'enrollment.read','enrollment.manage',

  'fees.invoice.read','fees.invoice.issue','fees.payment.record','fees.receipt.issue',
  'fees.receipt.void.request'
)
where r.tenant_id = :TENANT_ID and r.name = 'Secretary'
on conflict do nothing;

-- Teacher: academics + scoped student reads
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.code in (
  'tenant.profile.read',
  'structure.read',
  'students.profile.read',
  'enrollment.read',
  'attendance.read','attendance.mark','attendance.edit',
  'academics.assessments.read','academics.assessments.manage',
  'academics.results.read','academics.results.edit'
)
where r.tenant_id = :TENANT_ID and r.name = 'Teacher'
on conflict do nothing;

-- Parent: read-only portal (owned students enforced in backend)
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.code in (
  'tenant.profile.read',
  'students.profile.read',
  'enrollment.read',
  'attendance.read',
  'academics.results.read',
  'fees.invoice.read',
  'fees.ledger.read'
)
where r.tenant_id = :TENANT_ID and r.name = 'Parent'
on conflict do nothing;
