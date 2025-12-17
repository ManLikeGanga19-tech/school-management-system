
create table core.tenants (
  id uuid primary key default uuid_generate_v4(),
  slug varchar(100) not null unique,                 -- e.g. noveljuniorschool
  primary_domain varchar(255) unique,                -- e.g. portal.novel.ac.ke (optional)
  name varchar(255) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.tenant_settings (
  tenant_id uuid primary key references core.tenants(id) on delete cascade,

  -- Branding / personalization
  display_name varchar(255) not null,                -- can differ from tenants.name
  motto text,
  vision text,
  mission text,
  badge_url text,                                    -- public URL
  badge_storage_key text,                            -- storage object key (optional)
  theme_json jsonb not null default '{}'::jsonb,      -- colors, fonts etc.

  -- Contacts
  phone varchar(50),
  email varchar(255),
  address text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on core.tenants (is_active);
