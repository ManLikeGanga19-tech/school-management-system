
create table core.permissions (
  id uuid primary key default uuid_generate_v4(),
  code varchar(150) not null unique,                 -- e.g. fees.receipt.void.request
  description text
);

create table core.roles (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,
  name varchar(100) not null,                         -- Director, Secretary, Teacher, Parent
  description text,
  is_system boolean not null default true,            -- default roles per tenant

  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table core.role_permissions (
  role_id uuid not null references core.roles(id) on delete cascade,
  permission_id uuid not null references core.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- user role assignments (tenant-scoped)
create table core.user_roles (
  tenant_id uuid not null references core.tenants(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  role_id uuid not null references core.roles(id) on delete cascade,

  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, role_id)
);

create index on core.user_roles (tenant_id, user_id);
