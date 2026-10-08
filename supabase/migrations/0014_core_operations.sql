-- 0014: Phase 1 core operations. CRM leads (+ activity log), site visits, work orders, one shared task list, daily site
-- reports, project progress dimensions. Additive only; reuses customers, projects, invoices (quotations), employees,
-- documents (photos / files via document_relationships), in-app notifications and the reminder engine (reminder_sources).
-- No inventory / stock structures of any kind.

-- ───────────── permissions: CRM visibility (sales pipeline values are commercial data) ─────────────
insert into role_permissions(role, permission) values
  ('super_admin','crm.view'),('company_owner','crm.view'),('accountant','crm.view'),('project_manager','crm.view'),('viewer','crm.view')
on conflict do nothing;

-- ───────────── numbering: LD / SV / WO / DSR ─────────────
alter table document_number_formats drop constraint if exists document_number_formats_doc_type_check;
alter table document_number_formats add constraint document_number_formats_doc_type_check
  check (doc_type in ('quotation','invoice','delivery_note','purchase_order','credit_note','receipt','project','lead','site_visit','work_order','site_report'));

-- documents & relationships can belong to the new records (photos, measurements, drawings, attachments)
alter table documents drop constraint if exists documents_owner_type_check;
alter table documents add constraint documents_owner_type_check check (owner_type in ('company','employee','project','asset','cheque','vault','lead','site_visit','work_order'));
alter table document_relationships drop constraint if exists document_relationships_related_type_check;
alter table document_relationships add constraint document_relationships_related_type_check check (related_type in
  ('company','employee','customer','supplier','project','vehicle','asset','invoice','quotation','delivery_note','purchase_order','cheque','payment','lead','site_visit','work_order','site_report','task'));

-- ───────────── leads ─────────────
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number text not null,
  company_name text not null check (length(company_name) between 1 and 200),
  contact_person text check (length(contact_person) <= 120),
  phone text check (length(phone) <= 40), whatsapp text check (length(whatsapp) <= 40), email text check (length(email) <= 200),
  location text check (length(location) <= 300), address text check (length(address) <= 1000), trn text check (length(trn) <= 20),
  source text not null default 'other' check (source in ('website','google','facebook','instagram','whatsapp','referral','existing_customer','walk_in','tender','cold_call','other')),
  service text check (length(service) <= 300),
  estimated_value numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  probability int check (probability is null or probability between 0 and 100),   -- user-entered; stage default applies when null
  expected_close date,
  salesperson_id uuid references profiles(id) on delete set null,
  next_followup date,
  stage text not null default 'new' check (stage in ('new','contacted','site_visit_required','site_visit_completed','quotation_preparation','quotation_sent','negotiation','follow_up','won','lost','on_hold')),
  lost_reason text check (lost_reason in ('price','competitor','cancelled','no_response','timeline','specification','customer_decision','other')),
  lost_note text check (length(lost_note) <= 500),
  notes text check (length(notes) <= 4000),
  customer_id uuid references customers(id) on delete set null,          -- Lead → Customer (set on conversion)
  project_id uuid references projects(id) on delete set null,
  won_at timestamptz, lost_at timestamptz,
  client_token uuid,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid references profiles(id),
  unique (company_id, number)
);
create index if not exists leads_stage_idx on leads(company_id, stage) where deleted_at is null;
create index if not exists leads_followup_idx on leads(company_id, next_followup) where deleted_at is null;
create index if not exists leads_source_idx on leads(company_id, source, created_at);
create index if not exists leads_name_idx on leads(company_id, lower(company_name));
create unique index if not exists leads_client_token_uidx on leads(company_id, client_token) where client_token is not null;

create table if not exists lead_activities (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  kind text not null check (kind in ('note','call','whatsapp','email','meeting','stage','site_visit','quotation','converted')),
  body text check (length(body) <= 2000),
  from_stage text, to_stage text,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lead_activities_lead_idx on lead_activities(lead_id, created_at desc);

-- stage changes are always written to the activity log (drag-and-drop or form), with won / lost timestamps
create or replace function lead_stage_track() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into lead_activities(company_id, lead_id, kind, from_stage, to_stage, user_id) values (new.company_id, new.id, 'stage', old.stage, new.stage, auth.uid());
    new.won_at := case when new.stage = 'won' then coalesce(new.won_at, now()) else null end;
    new.lost_at := case when new.stage = 'lost' then coalesce(new.lost_at, now()) else null end;
    if new.stage <> 'lost' then new.lost_reason := null; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists lead_stage_track_t on leads;
create trigger lead_stage_track_t before update on leads for each row execute function lead_stage_track();
revoke execute on function lead_stage_track() from public, anon, authenticated;

-- Lead → Quotation link
alter table invoices add column if not exists lead_id uuid references leads(id) on delete set null;
create index if not exists invoices_lead_idx on invoices(lead_id) where lead_id is not null;
-- why a quotation was lost (win / loss analytics)
alter table invoices add column if not exists lost_reason text check (lost_reason in ('price','competitor','cancelled','no_response','timeline','specification','customer_decision','other'));
alter table customers add column if not exists lead_id uuid references leads(id) on delete set null;

-- ───────────── site visits ─────────────
create table if not exists site_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number text not null,
  lead_id uuid references leads(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  location text check (length(location) <= 300),
  scheduled_date date not null, scheduled_time time,
  employee_id uuid references employees(id) on delete set null,          -- assigned employee
  contact_person text check (length(contact_person) <= 120), contact_phone text check (length(contact_phone) <= 40),
  attendees text check (length(attendees) <= 500),
  notes text check (length(notes) <= 4000), measurements text check (length(measurements) <= 4000),
  requirements text check (length(requirements) <= 4000), recommendations text check (length(recommendations) <= 4000),
  followup_action text check (length(followup_action) <= 1000),
  status text not null default 'scheduled' check (status in ('scheduled','completed','rescheduled','cancelled','follow_up_required')),
  completed_at timestamptz,
  prepared_by uuid references profiles(id),
  client_token uuid,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid references profiles(id),
  unique (company_id, number),
  check (lead_id is not null or customer_id is not null or project_id is not null)
);
create index if not exists site_visits_date_idx on site_visits(company_id, scheduled_date) where deleted_at is null;
create index if not exists site_visits_lead_idx on site_visits(lead_id) where lead_id is not null;
create index if not exists site_visits_project_idx on site_visits(project_id) where project_id is not null;
create unique index if not exists site_visits_client_token_uidx on site_visits(company_id, client_token) where client_token is not null;

-- ───────────── work orders (job cards) ─────────────
create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number text not null,
  title text not null check (length(title) between 1 and 200),
  customer_id uuid references customers(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  quotation_id uuid references invoices(id) on delete set null,
  scope text check (length(scope) <= 8000),
  site_location text check (length(site_location) <= 300),
  start_date date, target_date date,
  manager_id uuid references profiles(id) on delete set null,
  equipment text check (length(equipment) <= 2000),
  instructions text check (length(instructions) <= 4000),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'pending' check (status in ('pending','approved','scheduled','in_fabrication','ready_for_site','installation','inspection','completed','on_hold','cancelled')),
  completed_at timestamptz,
  client_token uuid,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid references profiles(id),
  unique (company_id, number),
  check (target_date is null or start_date is null or target_date >= start_date)
);
create index if not exists work_orders_status_idx on work_orders(company_id, status) where deleted_at is null;
create index if not exists work_orders_project_idx on work_orders(project_id) where project_id is not null;
create index if not exists work_orders_quotation_idx on work_orders(quotation_id) where quotation_id is not null;
create unique index if not exists work_orders_client_token_uidx on work_orders(company_id, client_token) where client_token is not null;

create table if not exists work_order_members (
  company_id uuid not null references companies(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  role text check (length(role) <= 80),
  primary key (work_order_id, employee_id)
);
create table if not exists work_order_assets (
  company_id uuid not null references companies(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  primary key (work_order_id, asset_id)
);

-- ───────────── tasks: one list for the whole company; work-order tasks are tasks with work_order_id ─────────────
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  description text check (length(description) <= 4000),
  owner_id uuid references profiles(id) on delete set null,              -- the user responsible (gets notifications)
  employee_id uuid references employees(id) on delete set null,          -- field worker doing it (no login needed)
  start_date date, due_date date,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'todo' check (status in ('todo','in_progress','waiting','completed','cancelled')),
  completion int not null default 0 check (completion between 0 and 100),
  related_type text check (related_type in ('project','customer','employee','document','vehicle','asset','invoice','quotation','lead','supplier','work_order','site_visit')),
  related_id uuid,
  project_id uuid references projects(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete cascade,
  position int not null default 0,
  completed_at timestamptz,
  client_token uuid,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid references profiles(id),
  check ((related_type is null) = (related_id is null))
);
create index if not exists tasks_owner_idx on tasks(company_id, owner_id, status) where deleted_at is null;
create index if not exists tasks_due_idx on tasks(company_id, due_date) where deleted_at is null and status in ('todo','in_progress','waiting');
create index if not exists tasks_wo_idx on tasks(work_order_id, position) where work_order_id is not null;
create index if not exists tasks_project_idx on tasks(project_id) where project_id is not null;
create index if not exists tasks_related_idx on tasks(related_type, related_id) where related_id is not null;
create unique index if not exists tasks_client_token_uidx on tasks(company_id, client_token) where client_token is not null;

-- completing a task stamps it (100%); reopening clears the stamp
create or replace function task_track() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' then new.completion := 100; new.completed_at := coalesce(new.completed_at, now());
  else new.completed_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists task_track_t on tasks;
create trigger task_track_t before insert or update on tasks for each row execute function task_track();

-- ───────────── daily site reports ─────────────
create table if not exists daily_site_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number text not null,
  project_id uuid not null references projects(id) on delete cascade,
  work_order_id uuid references work_orders(id) on delete set null,
  report_date date not null,
  site text check (length(site) <= 300),
  supervisor_id uuid references employees(id) on delete set null,
  work_done text check (length(work_done) <= 8000), work_planned text check (length(work_planned) <= 4000),
  progress int check (progress is null or progress between 0 and 100),
  issues text check (length(issues) <= 4000), delays text check (length(delays) <= 4000),
  safety_notes text check (length(safety_notes) <= 4000), customer_instructions text check (length(customer_instructions) <= 4000),
  materials_delivered text check (length(materials_delivered) <= 4000), equipment_used text check (length(equipment_used) <= 2000),
  weather text check (length(weather) <= 120), notes text check (length(notes) <= 4000),
  client_token uuid,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid references profiles(id),
  unique (company_id, number)
);
create index if not exists dsr_project_idx on daily_site_reports(project_id, report_date desc) where deleted_at is null;
create index if not exists dsr_wo_idx on daily_site_reports(work_order_id) where work_order_id is not null;
create unique index if not exists dsr_client_token_uidx on daily_site_reports(company_id, client_token) where client_token is not null;
create table if not exists site_report_attendance (
  company_id uuid not null references companies(id) on delete cascade,
  report_id uuid not null references daily_site_reports(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  primary key (report_id, employee_id)
);

-- ───────────── project progress dimensions (entered, never invented) ─────────────
alter table projects
  add column if not exists inspection_progress int not null default 0 check (inspection_progress between 0 and 100),
  add column if not exists overall_progress int check (overall_progress is null or overall_progress between 0 and 100);   -- null = derived on screen

-- ───────────── project cost control: the estimated cost per category (entered by the user; actuals come from expenses) ─────────────
create table if not exists project_budgets (
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  category text not null check (category in ('material','labour','transport','fuel','equipment','subcontract','accommodation','food','maintenance','other')),
  amount numeric(14,2) not null check (amount >= 0),
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (project_id, category)
);

-- ───────────── RLS ─────────────
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leads') then perform apply_standard_rls('leads', 'crm.view', 'records.edit'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_visits') then perform apply_standard_rls('site_visits', 'documents.view', 'records.edit'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_orders') then perform apply_standard_rls('work_orders', 'documents.view', 'records.edit'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_order_members') then perform apply_standard_rls('work_order_members', 'documents.view', 'records.edit'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_order_assets') then perform apply_standard_rls('work_order_assets', 'documents.view', 'records.edit'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks') then perform apply_standard_rls('tasks', 'documents.view', 'records.edit'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'daily_site_reports') then perform apply_standard_rls('daily_site_reports', 'documents.view', 'records.edit'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_budgets') then perform apply_standard_rls('project_budgets', 'finance.view', 'records.edit'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_report_attendance') then perform apply_standard_rls('site_report_attendance', 'documents.view', 'records.edit'); end if;
end $$;
-- crew / equipment / attendance rows are part of editing the parent record (not a destructive delete)
do $$ declare t text; begin
  foreach t in array array['work_order_members','work_order_assets','site_report_attendance','project_budgets'] loop
    execute format('drop policy if exists tenant_delete on %I', t);
    execute format('create policy tenant_delete on %I for delete to authenticated using (company_id = current_company_id() and has_permission(''records.edit''))', t);
  end loop;
end $$;
alter table lead_activities enable row level security;
drop policy if exists la_select on lead_activities; drop policy if exists la_insert on lead_activities;
create policy la_select on lead_activities for select to authenticated using (company_id = current_company_id() and has_permission('crm.view'));
create policy la_insert on lead_activities for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit') and user_id = auth.uid() and exists (select 1 from leads l where l.id = lead_id));
-- activity history is immutable: no update / delete policy

-- tasks assigned to me stay visible even without documents.view (e.g. a field supervisor login)
drop policy if exists tasks_mine on tasks;
create policy tasks_mine on tasks for select to authenticated using (company_id = current_company_id() and owner_id = auth.uid());
drop policy if exists tasks_mine_update on tasks;
create policy tasks_mine_update on tasks for update to authenticated using (company_id = current_company_id() and owner_id = auth.uid()) with check (company_id = current_company_id() and owner_id = auth.uid());

-- soft-deleted rows are invisible everywhere
do $$ declare t text; begin
  foreach t in array array['leads','site_visits','work_orders','tasks','daily_site_reports'] loop
    execute format('drop policy if exists not_deleted on %I', t);
    execute format('create policy not_deleted on %I as restrictive for select to authenticated using (deleted_at is null)', t);
    execute format('drop trigger if exists audit_%1$s on %1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row()', t);
  end loop;
end $$;

create or replace function next_document_number(p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare cid uuid := current_company_id(); yr int; n bigint; prefix text; f document_number_formats; num text;
begin
  if cid is null or not has_permission('records.edit') then raise exception 'insufficient privilege'; end if;
  prefix := case p_doc_type when 'quotation' then 'QTN' when 'invoice' then 'INV' when 'delivery_note' then 'DN'
    when 'purchase_order' then 'PO' when 'credit_note' then 'CN' when 'receipt' then 'RCT' when 'project' then 'PRJ'
    when 'lead' then 'LD' when 'site_visit' then 'SV' when 'work_order' then 'WO' when 'site_report' then 'DSR' else null end;
  if prefix is null then raise exception 'unknown document type %', p_doc_type; end if;
  select extract(year from (now() at time zone c.timezone))::int into yr from companies c where c.id = cid;

  -- custom format: the row lock serialises concurrent callers → never a duplicate
  select * into f from document_number_formats where company_id = cid and doc_type = p_doc_type for update;
  if found then
    if f.yearly_reset and f.last_year is not null and f.last_year <> yr then f.next_seq := f.reset_to; end if;
    loop
      num := format_document_number(f.prefix, f.fixed_digits, f.seq_pad, f.next_seq, f.year_separator, case when f.include_year then yr end);
      f.next_seq := f.next_seq + 1;
      exit when not (case p_doc_type
        when 'project' then exists (select 1 from projects p where p.company_id = cid and p.code = num)
        when 'lead' then exists (select 1 from leads x where x.company_id = cid and x.number = num)
        when 'site_visit' then exists (select 1 from site_visits x where x.company_id = cid and x.number = num)
        when 'work_order' then exists (select 1 from work_orders x where x.company_id = cid and x.number = num)
        when 'site_report' then exists (select 1 from daily_site_reports x where x.company_id = cid and x.number = num)
        else exists (select 1 from invoices i where i.company_id = cid and i.doc_type = p_doc_type and i.number = num) end);
    end loop;
    update document_number_formats set next_seq = f.next_seq, last_year = yr where company_id = cid and doc_type = p_doc_type;
    return num;
  end if;

  insert into document_counters(company_id, doc_type, year, last) values (cid, p_doc_type, yr, 1)
    on conflict (company_id, doc_type, year) do update set last = document_counters.last + 1
    returning last into n;
  return prefix || '-' || yr || '-' || lpad(n::text, 4, '0');
end $$;

revoke all on function next_document_number(text) from public, anon;
grant execute on function next_document_number(text) to authenticated;

create or replace view reminder_sources with (security_invoker = true) as
  select d.company_id, 'document'::text as source_type, d.id as source_id,
         d.name as title,
         case when d.owner_type = 'employee' then (select e.full_name from employees e where e.id = d.owner_id) end as subject,
         coalesce(c.name, '') as category,
         d.owner_type as owner_type,
         d.expiry_date as due_date,
         coalesce(d.reminder_days, c.default_reminder_days) as offsets,
         null::numeric as amount, null::text as direction,
         case when d.owner_type = 'employee' then '/employees/' || d.owner_id else '/documents/' || d.id end as link
  from documents d left join document_categories c on c.id = d.category_id
  where d.deleted_at is null and d.reminders_active and d.expiry_date is not null and d.status not in ('cancelled','archived')
    and (d.owner_type <> 'employee' or exists (select 1 from employees e where e.id = d.owner_id and e.deleted_at is null))
  union all
  select ch.company_id, 'cheque', ch.id, 'Cheque ' || ch.cheque_no, ch.party_name, ch.bank_name, ch.direction,
         ch.cheque_date, null, ch.amount, ch.direction, '/cheques?open=' || ch.id
  from cheques ch where ch.status in ('received','issued','scheduled','deposited','presented')
  union all
  select r.company_id, 'custom', r.id, r.title, null, 'Custom', 'custom', r.due_date, r.offsets, null, null, '/reminders'
  from reminders r where r.enabled
  union all
  select i.company_id, 'invoice', i.id, 'Invoice ' || i.number, coalesce(i.customer_name, cu.name), 'Invoice', 'invoice', i.due_date, array[7,3,1,0],
         b.balance, null, '/invoices/' || i.id
  from invoices i join invoice_balances b on b.id = i.id left join customers cu on cu.id = i.customer_id
  where i.doc_type = 'invoice' and i.deleted_at is null and i.status in ('sent','partially_paid','overdue') and i.due_date is not null and b.balance > 0
  union all
  select m.company_id, 'milestone', m.id, m.title, p.name, 'Project milestone', 'project', m.due_date, array[7,3,1,0], null, null, '/projects/' || m.project_id
  from project_milestones m join projects p on p.id = m.project_id
  where not m.done and p.deleted_at is null and p.status not in ('completed','cancelled')
  union all
  select a.company_id, x.kind, a.id, x.label || ' – ' || a.name, coalesce(a.plate_or_serial, a.asset_code), x.label, 'asset', x.due, a.reminder_days, null, null, '/assets/' || a.id
  from assets a
  cross join lateral (values
    ('asset_registration', case when a.kind = 'vehicle' then 'Mulkiya / registration' else 'Registration' end, a.registration_expiry),
    ('asset_insurance', 'Insurance', a.insurance_expiry),
    ('asset_inspection', 'Inspection', a.inspection_expiry),
    ('asset_warranty', 'Warranty', a.warranty_expiry),
    ('asset_service', 'Maintenance', a.next_service_date)) as x(kind, label, due)
  where x.due is not null and a.archived_at is null and a.deleted_at is null and a.status not in ('sold','disposed')
  union all
  select f.company_id, 'followup', f.id, 'Follow up ' || i.number, coalesce(i.customer_name, cu.name), 'Quotation follow-up', 'quotation', f.due_date, array[0], i.total, null, '/invoices/' || i.id
  from sales_followups f join invoices i on i.id = f.invoice_id left join customers cu on cu.id = i.customer_id
  where f.done_at is null and i.deleted_at is null and i.status in ('sent','viewed','follow_up')
  union all
  select l.company_id, 'lead_followup', l.id, 'Follow up lead ' || l.number, l.company_name, 'Lead follow-up', 'lead', l.next_followup, array[0], l.estimated_value, null, '/leads/' || l.id
  from leads l where l.deleted_at is null and l.next_followup is not null and l.stage not in ('won','lost','on_hold')
  union all
  select v.company_id, 'site_visit', v.id, 'Site visit ' || v.number, coalesce(v.location, ''), 'Site visit', 'site_visit', v.scheduled_date, array[1,0], null, null, '/site-visits/' || v.id
  from site_visits v where v.deleted_at is null and v.status in ('scheduled','rescheduled')
  union all
  select t.company_id, 'task', t.id, t.title, null, 'Task', 'task', t.due_date, array[1,0], null, null, '/tasks?open=' || t.id
  from tasks t where t.deleted_at is null and t.due_date is not null and t.status in ('todo','in_progress','waiting')
  union all
  select w.company_id, 'work_order', w.id, 'Work order ' || w.number || ' target', w.title, 'Work order', 'work_order', w.target_date, array[3,0], null, null, '/work-orders/' || w.id
  from work_orders w where w.deleted_at is null and w.target_date is not null and w.status not in ('completed','cancelled');

-- ───────────── trash: the new records use the same soft delete / restore / purge flow ─────────────
create or replace function trash_table(p_entity text) returns text language sql immutable set search_path = public as $$
  select case p_entity when 'customer' then 'customers' when 'supplier' then 'suppliers' when 'project' then 'projects'
    when 'invoice' then 'invoices' when 'employee' then 'employees' when 'asset' then 'assets' when 'document' then 'documents'
    when 'lead' then 'leads' when 'site_visit' then 'site_visits' when 'work_order' then 'work_orders' when 'task' then 'tasks'
    when 'site_report' then 'daily_site_reports' end
$$;

create or replace function trash_list() returns table(entity text, id uuid, label text, sub text, deleted_at timestamptz, deleted_by uuid)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := current_company_id();
begin
  if cid is null or not has_permission('records.delete') then raise exception 'insufficient privilege'; end if;
  return query
    select * from (
      select 'customer'::text, c.id, c.name, coalesce(c.phone, c.email, ''), c.deleted_at, c.deleted_by from customers c where c.company_id = cid and c.deleted_at is not null
      union all select 'supplier', s.id, s.name, coalesce(s.phone, s.email, ''), s.deleted_at, s.deleted_by from suppliers s where s.company_id = cid and s.deleted_at is not null
      union all select 'project', p.id, p.name, coalesce(p.code, ''), p.deleted_at, p.deleted_by from projects p where p.company_id = cid and p.deleted_at is not null
      union all select 'invoice', i.id, i.number, i.doc_type || coalesce(' · ' || i.customer_name, ''), i.deleted_at, i.deleted_by from invoices i where i.company_id = cid and i.deleted_at is not null and has_permission('finance.view')
      union all select 'employee', e.id, e.full_name, e.employee_no, e.deleted_at, e.deleted_by from employees e where e.company_id = cid and e.deleted_at is not null and has_permission('employees.view')
      union all select 'asset', a.id, a.name, coalesce(a.plate_or_serial, a.asset_code, ''), a.deleted_at, a.deleted_by from assets a where a.company_id = cid and a.deleted_at is not null
      union all select 'document', d.id, d.name, coalesce(d.folder, d.owner_type), d.deleted_at, null::uuid from documents d where d.company_id = cid and d.deleted_at is not null and can_view_document(d.owner_type, d.owner_id)
      union all select 'lead', l.id, l.number || ' · ' || l.company_name, coalesce(l.contact_person, ''), l.deleted_at, l.deleted_by from leads l where l.company_id = cid and l.deleted_at is not null and has_permission('crm.view')
      union all select 'site_visit', v.id, v.number, coalesce(v.location, ''), v.deleted_at, v.deleted_by from site_visits v where v.company_id = cid and v.deleted_at is not null
      union all select 'work_order', w.id, w.number || ' · ' || w.title, '', w.deleted_at, w.deleted_by from work_orders w where w.company_id = cid and w.deleted_at is not null
      union all select 'task', t.id, t.title, coalesce(t.due_date::text, ''), t.deleted_at, t.deleted_by from tasks t where t.company_id = cid and t.deleted_at is not null
      union all select 'site_report', r.id, r.number, r.report_date::text, r.deleted_at, r.deleted_by from daily_site_reports r where r.company_id = cid and r.deleted_at is not null
    ) x order by 5 desc limit 500;
end $$;
revoke execute on function trash_list() from public, anon;
grant execute on function trash_list() to authenticated;
