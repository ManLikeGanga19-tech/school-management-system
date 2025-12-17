
create table core.enrollments (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,

  student_id uuid not null references core.students(id) on delete cascade,
  term_id uuid not null references core.terms(id) on delete cascade,
  class_id uuid not null references core.classes(id) on delete cascade,

  enrolled_on date not null default current_date,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  unique (tenant_id, student_id, term_id)             -- one enrollment per student per term
);

create index on core.enrollments (tenant_id, class_id, term_id);
create index on core.enrollments (tenant_id, student_id);
