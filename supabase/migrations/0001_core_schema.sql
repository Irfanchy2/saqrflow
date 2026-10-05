-- SaqrFlow core schema. Every business table carries company_id (tenant key).
create extension if not exists pgcrypto;

create type app_role as enum
  ('super_admin','company_owner','hr_manager','accountant','project_manager','employee','viewer');

-- ───────────── tenancy & identity ─────────────
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 200),
  trade_name text,
  timezone text not null default 'Asia/Dubai',
  currency text not null default 'AED',
  locale text not null default 'en' check (locale in ('en','ar','bn')),
  plan text not null default 'internal',            -- subscription architecture hook (Phase 4)
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  full_name text not null,
  role app_role not null default 'viewer',
  phone text,
  locale text not null default 'en' check (locale in ('en','ar','bn')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index profiles_company_idx on profiles(company_id);

create table role_permissions (
  role app_role not null,
  permission text not null,
  primary key (role, permission)
);

-- ───────────── documents ─────────────
create table document_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  scope text not null default 'company' check (scope in ('company','employee','vehicle','other')),
  name text not null check (length(name) between 1 and 120),
  default_reminder_days int[],                       -- null => company default schedule
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, scope, name)
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,   -- links an "employee"-role login to the record
  employee_no text not null,
  full_name text not null check (length(full_name) between 2 and 200),
  photo_path text,
  nationality text,
  department text,
  designation text,
  phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  joining_date date,
  status text not null default 'active' check (status in ('active','on_leave','probation','resigned','terminated','archived')),
  work_location text,
  accommodation text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_no)
);
create index employees_company_status_idx on employees(company_id, status);
create index employees_name_idx on employees(company_id, lower(full_name));

create table documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  owner_type text not null default 'company' check (owner_type in ('company','employee','project','asset','cheque','vault')),
  owner_id uuid,                                     -- employee/project/asset/cheque id (no FK: polymorphic)
  category_id uuid references document_categories(id) on delete set null,
  name text not null check (length(name) between 1 and 250),
  reference_no text,                                 -- may be sensitive (e.g. passport no.) – never sent over WhatsApp
  issuing_authority text,
  issue_date date,
  expiry_date date,
  responsible_user_id uuid references profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active','renewal_in_progress','cancelled')),
  renewal_fee numeric(12,2) check (renewal_fee is null or renewal_fee >= 0),
  notes text,
  folder text,
  reminders_active boolean not null default true,    -- AI-extracted docs start false until verified
  reminder_days int[],                               -- per-document override
  current_version_id uuid,
  deleted_at timestamptz,
  deleted_by uuid references profiles(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
create index documents_company_expiry_idx on documents(company_id, expiry_date) where deleted_at is null;
create index documents_owner_idx on documents(company_id, owner_type, owner_id);
create index documents_search_idx on documents using gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(reference_no,'')||' '||coalesce(issuing_authority,'')));

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  version_no int not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  note text,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, version_no)
);
create index document_versions_hash_idx on document_versions(company_id, sha256);
alter table documents add constraint documents_current_version_fk
  foreign key (current_version_id) references document_versions(id) deferrable initially deferred;

create table document_renewals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  renewed_at date not null default current_date,
  previous_expiry date,
  new_expiry date not null,
  fee numeric(12,2),
  notes text,
  performed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table document_access_logs (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid references profiles(id),
  action text not null check (action in ('view','download','upload','replace','delete','restore')),
  created_at timestamptz not null default now()
);
create index document_access_doc_idx on document_access_logs(document_id, created_at desc);

-- ───────────── HR (salary data deliberately in separate tables) ─────────────
create table employee_compensation (
  employee_id uuid primary key references employees(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  monthly_salary numeric(12,2) not null check (monthly_salary >= 0),
  updated_at timestamptz not null default now()
);
create table salary_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  period date not null,                              -- first day of month paid
  amount numeric(12,2) not null check (amount >= 0),
  paid_on date,
  method text check (method in ('wps','bank_transfer','cash','cheque')),
  notes text,
  created_at timestamptz not null default now(),
  unique (employee_id, period)
);
create table employee_advances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null check (kind in ('advance','deduction')),
  amount numeric(12,2) not null check (amount > 0),
  given_on date not null default current_date,
  monthly_recovery numeric(12,2),
  settled boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create table leave_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type text not null check (leave_type in ('annual','sick','unpaid','emergency','other')),
  start_date date not null,
  end_date date not null,
  status text not null default 'approved' check (status in ('pending','approved','rejected')),
  notes text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  work_date date not null,
  status text not null check (status in ('present','absent','half_day','leave','holiday')),
  overtime_hours numeric(4,1) not null default 0,
  notes text,
  unique (employee_id, work_date)
);

-- ───────────── parties, banking ─────────────
create table customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null, contact_person text, phone text, email text, trn text, address text, notes text,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create table suppliers (like customers including all);
alter table suppliers add constraint suppliers_company_fk foreign key (company_id) references companies(id) on delete cascade;

create table banks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  account_display_name text,                         -- label only. NEVER store credentials or full account numbers
  created_at timestamptz not null default now(),
  unique (company_id, name, account_display_name)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null, customer_id uuid references customers(id) on delete set null,
  location text, contract_value numeric(14,2), start_date date, expected_completion date,
  manager_id uuid references profiles(id) on delete set null,
  status text not null default 'planning' check (status in ('planning','active','on_hold','completed','cancelled')),
  notes text, created_at timestamptz not null default now()
);
create table invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  doc_type text not null default 'invoice' check (doc_type in ('invoice','quotation','purchase_order')),
  number text not null, customer_id uuid references customers(id), supplier_id uuid references suppliers(id),
  project_id uuid references projects(id) on delete set null,
  issue_date date not null default current_date, due_date date,
  subtotal numeric(14,2) not null default 0, vat_rate numeric(5,2) not null default 5, total numeric(14,2) not null default 0,
  status text not null default 'draft' check (status in ('draft','sent','partially_paid','paid','overdue','cancelled')),
  notes text, created_at timestamptz not null default now(),
  unique (company_id, doc_type, number)
);
create table payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  cheque_id uuid, amount numeric(14,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text check (method in ('cash','bank_transfer','cheque','card','other')), notes text,
  created_at timestamptz not null default now()
);
create table assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null default 'vehicle' check (kind in ('vehicle','equipment','machinery')),
  name text not null, plate_or_serial text, assigned_to uuid references employees(id) on delete set null,
  registration_expiry date, insurance_expiry date, warranty_expiry date, next_service_date date,
  notes text, created_at timestamptz not null default now()
);

create table cheques (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  cheque_no text not null,
  direction text not null check (direction in ('incoming','outgoing')),
  kind text not null default 'regular' check (kind in ('regular','pdc','security','rental')),
  party_type text not null default 'customer' check (party_type in ('customer','supplier','landlord','other')),
  customer_id uuid references customers(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  party_name text not null,
  bank_id uuid references banks(id) on delete set null,
  bank_name text not null,
  account_display_name text,
  amount numeric(14,2) not null check (amount > 0),
  issue_date date,
  cheque_date date not null,
  deposit_date date,
  purpose text,
  invoice_id uuid references invoices(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  status text not null check (status in ('received','issued','scheduled','deposited','presented','cleared','returned','cancelled')),
  cleared_at timestamptz,
  cleared_by uuid references profiles(id),
  returned_reason text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((direction='incoming' and status <> 'issued' and status <> 'presented')
      or (direction='outgoing' and status <> 'received' and status <> 'deposited'))
);
create index cheques_company_date_idx on cheques(company_id, cheque_date);
create index cheques_company_status_idx on cheques(company_id, status);
alter table payments add constraint payments_cheque_fk foreign key (cheque_id) references cheques(id) on delete set null;

-- ───────────── reminders & notifications ─────────────
create table reminders (                              -- custom events / recurring tasks
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null, notes text, due_date date not null,
  offsets int[],                                       -- null => company default schedule
  recurrence text not null default 'none' check (recurrence in ('none','monthly','quarterly','yearly')),
  enabled boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table notification_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  name text not null,
  whatsapp_number text check (whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  channels text[] not null default array['in_app'],
  whatsapp_opt_in text not null default 'pending' check (whatsapp_opt_in in ('pending','opted_in','opted_out')),
  opted_in_at timestamptz,
  quiet_start time, quiet_end time,                    -- local company time
  receives_digest boolean not null default false,
  receives_cheque_alerts boolean not null default true,
  receives_hr_alerts boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index notif_recipients_company_idx on notification_recipients(company_id) where is_active;

create table notification_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  recipient_id uuid references notification_recipients(id) on delete set null,
  channel text not null check (channel in ('whatsapp','email','in_app')),
  template text not null,
  params jsonb not null default '{}'::jsonb,           -- whitelisted, non-sensitive values only
  source_type text, source_id uuid,
  dedupe_key text not null,
  status text not null default 'queued' check (status in ('queued','sending','retry','sent','delivered','read','failed','skipped','sandbox')),
  sandbox boolean not null default false,
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  provider_message_id text,
  last_error text,
  fallback_of uuid references notification_logs(id),
  cost_estimate numeric(8,4),
  sent_at timestamptz, delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, dedupe_key)                      -- duplicate-message prevention
);
create index notif_logs_queue_idx on notification_logs(next_attempt_at) where status in ('queued','retry','sending');
create index notif_logs_provider_idx on notification_logs(provider_message_id);
create index notif_logs_company_idx on notification_logs(company_id, created_at desc);

create table in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null, body text, link text,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  dedupe_key text, read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index in_app_user_idx on in_app_notifications(user_id, read_at, created_at desc);

create table app_settings (
  company_id uuid not null references companies(id) on delete cascade,
  key text not null, value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);
create table integration_secrets (                    -- AES-GCM ciphertext only; service-role access only
  company_id uuid not null references companies(id) on delete cascade,
  name text not null, ciphertext text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, name)
);

create table audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid references companies(id) on delete set null,
  user_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index audit_company_idx on audit_logs(company_id, created_at desc);
