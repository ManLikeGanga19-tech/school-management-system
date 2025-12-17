-- 007_fees.sql
-- Paste finalized SQL here.
-- Optional: define fee account per student (simple ledger basis)
create table core.fee_accounts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,
  student_id uuid not null unique references core.students(id) on delete cascade,

  opened_at timestamptz not null default now()
);

-- Invoices
create table core.invoices (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,

  student_id uuid not null references core.students(id) on delete restrict,
  term_id uuid references core.terms(id) on delete set null,

  invoice_no varchar(50) not null,
  issued_on date not null default current_date,
  due_on date,

  currency varchar(10) not null default 'KES',
  amount_total numeric(12,2) not null check (amount_total >= 0),

  status varchar(30) not null default 'ISSUED',       -- ISSUED, PAID, CANCELLED
  notes text,

  issued_by_user_id uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),

  unique (tenant_id, invoice_no)
);

-- Payments recorded manually
create table core.payments (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,

  student_id uuid not null references core.students(id) on delete restrict,
  invoice_id uuid references core.invoices(id) on delete set null,

  paid_on date not null default current_date,
  currency varchar(10) not null default 'KES',
  amount numeric(12,2) not null check (amount > 0),

  method varchar(30) not null default 'CASH',         -- CASH, MPESA, BANK, CHEQUE, OTHER
  reference varchar(120),                              -- mpesa code / bank ref
  received_by_user_id uuid references core.users(id) on delete set null,

  created_at timestamptz not null default now()
);

-- Receipts issued after payment record
create table core.receipts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references core.tenants(id) on delete cascade,

  student_id uuid not null references core.students(id) on delete restrict,
  payment_id uuid not null references core.payments(id) on delete restrict,

  receipt_no varchar(50) not null,
  issued_on date not null default current_date,

  currency varchar(10) not null default 'KES',
  amount numeric(12,2) not null check (amount > 0),

  status varchar(30) not null default 'ISSUED',
  -- ISSUED, VOID_REQUESTED, VOIDED, VOID_REJECTED

  issued_by_user_id uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- void workflow
  void_requested_by_user_id uuid references core.users(id) on delete set null,
  void_requested_at timestamptz,
  void_reason text,

  void_reviewed_by_user_id uuid references core.users(id) on delete set null,
  void_reviewed_at timestamptz,
  void_review_decision varchar(20),                   -- APPROVED / REJECTED
  void_review_note text,

  unique (tenant_id, receipt_no),
  unique (tenant_id, payment_id)                      -- one receipt per payment
);

create index on core.invoices (tenant_id, student_id, issued_on);
create index on core.payments (tenant_id, student_id, paid_on);
create index on core.receipts (tenant_id, student_id, issued_on);
create index on core.receipts (tenant_id, status);

-- Helpful view: student balance (simple)
-- (Invoice total - payments total). In production you can refine with cancellations, allocations, etc.
create or replace view core.v_student_fee_balance as
select
  s.tenant_id,
  s.id as student_id,
  coalesce(sum(i.amount_total), 0) as invoices_total,
  coalesce(sum(p.amount), 0) as payments_total,
  coalesce(sum(i.amount_total), 0) - coalesce(sum(p.amount), 0) as balance
from core.students s
left join core.invoices i
  on i.tenant_id = s.tenant_id and i.student_id = s.id and i.status <> 'CANCELLED'
left join core.payments p
  on p.tenant_id = s.tenant_id and p.student_id = s.id
group by s.tenant_id, s.id;
