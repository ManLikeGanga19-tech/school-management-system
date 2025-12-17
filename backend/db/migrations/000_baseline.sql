
create schema if not exists core;

create table if not exists core.schema_migrations (
  version varchar(50) primary key,
  applied_at timestamptz not null default now()
);
