
create table core.audit_log (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,

  actor_user_id uuid references core.users(id) on delete set null,
  action varchar(150) not null,                      
  entity_type varchar(100),                           
  entity_id uuid,                                     
  ip_address inet,
  user_agent text,

  -- store deltas safely
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index on core.audit_log (tenant_id, created_at desc);
create index on core.audit_log (tenant_id, action);
