
create table core.staff (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,
  user_id uuid unique references core.users(id) on delete set null,

  staff_no varchar(100),
  job_title varchar(120),                             -- Teacher, Secretary, Director, etc.
  is_active boolean not null default true,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  unique (tenant_id, staff_no)
);

-- Parent/Guardian profile (links to users for login)
create table core.parents (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,
  user_id uuid unique references core.users(id) on delete set null,

  national_id varchar(100),
  occupation varchar(120),
  is_active boolean not null default true,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  unique (tenant_id, national_id)
);

-- Students (domain entity)
create table core.students (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,

  admission_no varchar(120) not null,
  first_name varchar(120) not null,
  last_name varchar(120) not null,
  other_names varchar(120),
  gender varchar(20),
  date_of_birth date,

  status varchar(30) not null default 'ACTIVE',       -- ACTIVE, INACTIVE, GRADUATED, TRANSFERRED
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, admission_no)
);

-- Student profile photo metadata (no blobs)
create table core.student_photos (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,
  student_id uuid not null references core.students(id) on delete cascade,

  photo_url text not null,                            -- CDN/public URL
  storage_key text,                                   -- S3/R2 key
  content_type varchar(100),
  size_bytes bigint,

  uploaded_by_user_id uuid references core.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),

  is_current boolean not null default true
);

-- ensure only one current photo per student per tenant
create unique index student_one_current_photo
on core.student_photos (tenant_id, student_id)
where is_current = true;

-- Parent ↔ Student ownership mapping (for parent portal enforcement)
create table core.parent_students (
  tenant_id uuid not null references core.tenants(id) on delete cascade,
  parent_id uuid not null references core.parents(id) on delete cascade,
  student_id uuid not null references core.students(id) on delete cascade,

  relationship varchar(50) not null default 'GUARDIAN', -- MOTHER/FATHER/GUARDIAN
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  primary key (tenant_id, parent_id, student_id)
);

create index on core.students (tenant_id, last_name, first_name);
create index on core.parent_students (tenant_id, student_id);
