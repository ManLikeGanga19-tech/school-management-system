
create table core.academic_years (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,

  name varchar(50) not null,                          -- e.g. 2026
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,

  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table core.terms (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,
  academic_year_id uuid not null references core.academic_years(id) on delete cascade,

  name varchar(50) not null,                          -- Term 1, Term 2
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,

  created_at timestamptz not null default now(),
  unique (tenant_id, academic_year_id, name)
);

create table core.classes (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,

  grade varchar(50) not null,                         -- e.g. Grade 6
  stream varchar(50),                                 -- e.g. Blue
  name varchar(120) generated always as
    (case when stream is null or stream = '' then grade else grade || ' ' || stream end) stored,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  unique (tenant_id, grade, stream)
);

create index on core.classes (tenant_id, is_active);
