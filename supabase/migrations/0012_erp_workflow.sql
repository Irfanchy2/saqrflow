-- 0012: connected sales workflow (statuses, revisions, partial delivery, credit notes, follow-ups, approval, send history),
-- item catalog & terms templates, trash/restore, customer ledger fields, payment idempotency, expenses, asset maintenance.
-- Additive only: no existing row is changed except where a new column gets its default.

-- ───────────── permissions ─────────────
insert into role_permissions(role, permission) values
  ('super_admin','sales.approve'),('company_owner','sales.approve'),
  ('super_admin','records.purge'),('company_owner','records.purge')
on conflict do nothing;

-- ───────────── numbering: project references, optional year ─────────────
alter table document_number_formats drop constraint if exists document_number_formats_doc_type_check;
alter table document_number_formats add constraint document_number_formats_doc_type_check
  check (doc_type in ('quotation','invoice','delivery_note','purchase_order','credit_note','receipt','project'));
alter table document_number_formats add column if not exists include_year boolean not null default true;

create or replace function format_document_number(p_prefix text, p_fixed text, p_pad int, p_seq bigint, p_sep text, p_year int)
returns text language sql immutable set search_path = public as $$
  select p_prefix || p_fixed || lpad(p_seq::text, greatest(p_pad, length(p_seq::text)), '0')
         || case when p_year is null then '' else p_sep || p_year::text end
$$;

create or replace function next_document_number(p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare cid uuid := current_company_id(); yr int; n bigint; prefix text; f document_number_formats; num text;
begin
  if cid is null or not has_permission('records.edit') then raise exception 'insufficient privilege'; end if;
  prefix := case p_doc_type when 'quotation' then 'QTN' when 'invoice' then 'INV' when 'delivery_note' then 'DN'
    when 'purchase_order' then 'PO' when 'credit_note' then 'CN' when 'receipt' then 'RCT' when 'project' then 'PRJ' else null end;
  if prefix is null then raise exception 'unknown document type %', p_doc_type; end if;
  select extract(year from (now() at time zone c.timezone))::int into yr from companies c where c.id = cid;

  -- custom format: the row lock serialises concurrent callers → never a duplicate
  select * into f from document_number_formats where company_id = cid and doc_type = p_doc_type for update;
  if found then
    if f.yearly_reset and f.last_year is not null and f.last_year <> yr then f.next_seq := f.reset_to; end if;
    loop
      num := format_document_number(f.prefix, f.fixed_digits, f.seq_pad, f.next_seq, f.year_separator, case when f.include_year then yr end);
      f.next_seq := f.next_seq + 1;
      exit when not (case when p_doc_type = 'project'
        then exists (select 1 from projects p where p.company_id = cid and p.code = num)
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

-- ───────────── sales documents ─────────────
alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check check (status in
  ('draft','sent','viewed','follow_up','accepted','rejected','expired','converted','partially_paid','paid','overdue','cancelled','delivered'));
alter table invoices
  add column if not exists revision int not null default 0,
  add column if not exists apply_vat boolean,                 -- quotations: add VAT to the total (true) or only note it (false / legacy null)
  add column if not exists sent_at timestamptz,
  add column if not exists salesperson_id uuid references profiles(id) on delete set null,
  add column if not exists discount_type text not null default 'amount' check (discount_type in ('amount','percent')),
  add column if not exists discount_value numeric(14,4) not null default 0 check (discount_value >= 0),
  add column if not exists approval_status text check (approval_status in ('pending','approved','rejected','changes_requested')),
  add column if not exists approval_note text,
  add column if not exists approved_by uuid references profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists client_token uuid,                 -- idempotency: one click → one document
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id);
-- existing documents: the stored AED discount is the input value
update invoices set discount_value = discount where discount > 0 and discount_value = 0;
create unique index if not exists invoices_client_token_uidx on invoices(company_id, client_token) where client_token is not null;
create index if not exists invoices_quotation_idx on invoices(quotation_id) where quotation_id is not null;
create index if not exists invoices_source_idx on invoices(source_invoice_id) where source_invoice_id is not null;
create index if not exists invoices_status_idx on invoices(company_id, doc_type, status);
create index if not exists invoices_due_idx on invoices(company_id, due_date) where doc_type = 'invoice';

-- reusable products / services
create table if not exists catalog_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  description text check (length(description) <= 2000),
  unit text not null default 'Nos' check (length(unit) between 1 and 20),
  rate numeric(14,2) not null default 0 check (rate >= 0),
  vat_category text not null default 'standard' check (vat_category in ('standard','zero','exempt','out_of_scope')),
  category text check (length(category) <= 80),
  notes text check (length(notes) <= 1000),
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists catalog_items_company_idx on catalog_items(company_id, active, lower(name));

alter table invoice_items
  add column if not exists vat_category text not null default 'standard' check (vat_category in ('standard','zero','exempt','out_of_scope')),
  add column if not exists discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  add column if not exists source_item_id uuid references invoice_items(id) on delete set null,   -- DN line → quotation line
  add column if not exists catalog_item_id uuid references catalog_items(id) on delete set null;
create index if not exists invoice_items_source_idx on invoice_items(source_item_id) where source_item_id is not null;

-- terms & conditions templates
create table if not exists terms_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  kind text not null default 'terms' check (kind in ('terms','payment')),
  lines text[] not null default '{}',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, name)
);

-- revision history: the full document (header + lines) as it was before each change after it was sent
create table if not exists sales_doc_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  revision int not null,
  snapshot jsonb not null,
  changes text[] not null default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (invoice_id, revision)
);

-- what happened to a document (created, printed, downloaded, emailed …). "viewed" is only recorded by real tracking.
create table if not exists sales_doc_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  event text not null check (event in ('created','revised','status','converted','downloaded','printed','emailed','whatsapp','archived','payment','approval','followup')),
  detail text check (length(detail) <= 500),
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists sales_doc_events_doc_idx on sales_doc_events(invoice_id, created_at desc);

-- quotation follow-ups
create table if not exists sales_followups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  due_date date not null,
  note text check (length(note) <= 500),
  done_at timestamptz,
  done_by uuid references profiles(id),
  outcome text check (length(outcome) <= 500),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists sales_followups_due_idx on sales_followups(company_id, due_date) where done_at is null;
create index if not exists sales_followups_doc_idx on sales_followups(invoice_id);

-- delivered quantity per quotation line (partial deliveries)
create or replace view quotation_delivery with (security_invoker = true) as
  select qi.id as item_id, qi.invoice_id as quotation_id, qi.company_id, qi.quantity as ordered,
         coalesce(sum(di.quantity) filter (where dn.id is not null), 0)::numeric(14,3) as delivered
  from invoice_items qi
  left join invoice_items di on di.source_item_id = qi.id
  left join invoices dn on dn.id = di.invoice_id and dn.doc_type = 'delivery_note' and dn.status <> 'cancelled' and dn.deleted_at is null
  group by qi.id;

-- ───────────── payments & credit notes ─────────────
alter table payments
  add column if not exists idempotency_key uuid,
  add column if not exists bank_name text check (length(bank_name) <= 120),
  add column if not exists document_id uuid references documents(id) on delete set null;
create unique index if not exists payments_idem_uidx on payments(company_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists payments_cheque_uidx on payments(cheque_id) where cheque_id is not null;   -- a cheque settles an invoice once
create index if not exists payments_customer_idx on payments(company_id, customer_id, paid_on);

-- issued credit notes (doc_type credit_note, source_invoice_id → the invoice) reduce the invoice balance
create or replace function invoice_credits(p_invoice uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(total), 0) from invoices
  where source_invoice_id = p_invoice and doc_type = 'credit_note' and status not in ('draft','cancelled') and deleted_at is null
$$;
revoke execute on function invoice_credits(uuid) from public, anon;
grant execute on function invoice_credits(uuid) to authenticated;

create or replace view invoice_balances with (security_invoker = true) as
  select i.id, i.company_id, i.total, coalesce(p.paid, 0)::numeric(14,2) as paid,
         (i.total - coalesce(p.paid, 0) - coalesce(cn.credited, 0))::numeric(14,2) as balance,
         coalesce(cn.credited, 0)::numeric(14,2) as credited
  from invoices i
  left join (select invoice_id, sum(amount) paid from payments group by invoice_id) p on p.invoice_id = i.id
  left join (select source_invoice_id, sum(total) credited from invoices
             where doc_type = 'credit_note' and status not in ('draft','cancelled') and deleted_at is null group by source_invoice_id) cn on cn.source_invoice_id = i.id;

create or replace function refresh_invoice_status(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv record; paid numeric; credited numeric; today date;
begin
  select i.*, c.timezone into inv from invoices i join companies c on c.id = i.company_id where i.id = p_invoice;
  if inv is null or inv.doc_type <> 'invoice' or inv.status in ('draft','cancelled') then return; end if;
  select coalesce(sum(amount), 0) into paid from payments where invoice_id = p_invoice;
  credited := invoice_credits(p_invoice);
  today := (now() at time zone inv.timezone)::date;
  update invoices set status = case
      when inv.total > 0 and paid + credited >= inv.total then 'paid'
      when paid > 0 or credited > 0 then 'partially_paid'
      when inv.due_date is not null and inv.due_date < today then 'overdue'
      else 'sent' end,
    updated_at = now()
  where id = p_invoice;
end $$;

create or replace function payments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv record; other numeric;
begin
  if new.invoice_id is null then return new; end if;
  select * into inv from invoices where id = new.invoice_id;
  if inv.company_id <> new.company_id then raise exception 'invoice belongs to another company'; end if;
  if inv.doc_type <> 'invoice' then raise exception 'payments can only be recorded against tax invoices'; end if;
  if inv.status in ('draft','cancelled') then raise exception 'issue the invoice before recording payments'; end if;
  select coalesce(sum(amount), 0) into other from payments where invoice_id = new.invoice_id and id <> new.id;
  if other + new.amount > inv.total - invoice_credits(new.invoice_id) + 0.005 then
    raise exception 'payment exceeds the invoice balance (balance %)', round(inv.total - other - invoice_credits(new.invoice_id), 2);
  end if;
  new.customer_id := coalesce(new.customer_id, inv.customer_id);
  return new;
end $$;

-- a credit note can never exceed what is still owed on its invoice; issuing / cancelling it refreshes the invoice
create or replace function credit_note_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv record; other numeric; paid numeric;
begin
  if new.doc_type <> 'credit_note' or new.source_invoice_id is null then return new; end if;
  select * into inv from invoices where id = new.source_invoice_id;
  if inv is null or inv.company_id <> new.company_id or inv.doc_type <> 'invoice' then raise exception 'a credit note must reference a tax invoice of the same company'; end if;
  if new.status not in ('draft','cancelled') then
    if inv.status in ('draft','cancelled') then raise exception 'the invoice is not issued'; end if;
    select coalesce(sum(total), 0) into other from invoices where source_invoice_id = inv.id and doc_type = 'credit_note' and id <> new.id and status not in ('draft','cancelled') and deleted_at is null;
    select coalesce(sum(amount), 0) into paid from payments where invoice_id = inv.id;
    if new.total > inv.total - other - paid + 0.005 then
      raise exception 'credit note exceeds the invoice balance (balance %)', round(inv.total - other - paid, 2);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists credit_note_guard_t on invoices;
create trigger credit_note_guard_t before insert or update on invoices for each row execute function credit_note_guard();

create or replace function credit_note_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.doc_type = 'credit_note' and new.source_invoice_id is not null then perform refresh_invoice_status(new.source_invoice_id); end if;
  return null;
end $$;
drop trigger if exists credit_note_after_t on invoices;
create trigger credit_note_after_t after insert or update of status, total, deleted_at on invoices for each row execute function credit_note_after();
revoke execute on function credit_note_guard(), credit_note_after() from public, anon, authenticated;

-- ───────────── customers ─────────────
alter table customers
  add column if not exists whatsapp text check (length(whatsapp) <= 40),
  add column if not exists credit_days int check (credit_days between 0 and 365),
  add column if not exists opening_balance numeric(14,2) not null default 0,
  add column if not exists opening_balance_date date,
  add column if not exists created_by uuid references profiles(id),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id);
alter table suppliers
  add column if not exists whatsapp text check (length(whatsapp) <= 40),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id);
create index if not exists customers_trn_idx on customers(company_id, trn) where trn is not null;
create index if not exists customers_phone_idx on customers(company_id, phone) where phone is not null;
create index if not exists customers_email_idx on customers(company_id, lower(email)) where email is not null;

-- ───────────── projects, expenses ─────────────
alter table projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id);
create index if not exists projects_customer_idx on projects(company_id, customer_id);

alter table project_expenses alter column project_id drop not null;
alter table project_expenses drop constraint if exists project_expenses_category_check;
alter table project_expenses add constraint project_expenses_category_check check (category in
  ('material','labour','transport','fuel','equipment','subcontract','accommodation','food','maintenance','other'));
alter table project_expenses
  add column if not exists vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  add column if not exists payment_method text check (payment_method in ('cash','bank_transfer','cheque','card','credit','other')),
  add column if not exists supplier_name text check (length(supplier_name) <= 200),
  add column if not exists employee_id uuid references employees(id) on delete set null,
  add column if not exists receipt_document_id uuid references documents(id) on delete set null,
  add column if not exists notes text check (length(notes) <= 2000),
  add column if not exists idempotency_key uuid;
create unique index if not exists project_expenses_idem_uidx on project_expenses(company_id, idempotency_key) where idempotency_key is not null;
create index if not exists project_expenses_company_idx on project_expenses(company_id, spent_on desc);

-- ───────────── employees, assets ─────────────
alter table employees
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id);
alter table assets
  add column if not exists inspection_expiry date,
  add column if not exists last_service_date date,
  add column if not exists reminder_days int[],
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id);

create table if not exists asset_maintenance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  performed_on date not null,
  kind text not null default 'service' check (kind in ('service','repair','inspection','other')),
  description text not null check (length(description) between 1 and 1000),
  cost numeric(14,2) not null default 0 check (cost >= 0),
  vendor text check (length(vendor) <= 200),
  odometer int check (odometer >= 0),
  employee_id uuid references employees(id) on delete set null,
  next_due date,
  document_id uuid references documents(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists asset_maintenance_asset_idx on asset_maintenance(asset_id, performed_on desc);

create or replace function asset_maintenance_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update assets set
    last_service_date = (select max(performed_on) from asset_maintenance where asset_id = new.asset_id and kind in ('service','repair')),
    next_service_date = case when new.kind in ('service','repair') and new.next_due is not null then new.next_due else next_service_date end,
    inspection_expiry = case when new.kind = 'inspection' and new.next_due is not null then new.next_due else inspection_expiry end,
    updated_at = now()
  where id = new.asset_id and company_id = new.company_id;
  return null;
end $$;
drop trigger if exists asset_maintenance_after_t on asset_maintenance;
create trigger asset_maintenance_after_t after insert on asset_maintenance for each row execute function asset_maintenance_after();
revoke execute on function asset_maintenance_after() from public, anon, authenticated;

-- ───────────── RLS for the new tables ─────────────
do $$ begin
  perform apply_standard_rls('catalog_items', 'finance.view', 'records.edit');
  perform apply_standard_rls('terms_templates', 'finance.view', 'settings.manage');
  perform apply_standard_rls('sales_followups', 'finance.view', 'records.edit');
  perform apply_standard_rls('asset_maintenance', 'documents.view', 'records.edit');
end $$;

alter table sales_doc_revisions enable row level security;
create policy sdr_select on sales_doc_revisions for select to authenticated using (company_id = current_company_id() and has_permission('finance.view'));
create policy sdr_insert on sales_doc_revisions for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit'));
-- revisions are immutable: no update / delete policy

alter table sales_doc_events enable row level security;
create policy sde_select on sales_doc_events for select to authenticated using (company_id = current_company_id() and has_permission('finance.view'));
create policy sde_insert on sales_doc_events for insert to authenticated with check (
  company_id = current_company_id() and has_permission('finance.view') and user_id = auth.uid()
  and exists (select 1 from invoices i where i.id = invoice_id));

-- soft-deleted rows are invisible everywhere (lists, joins, search). Trash is read through trash_list().
do $$ declare t text; begin
  foreach t in array array['customers','suppliers','projects','invoices','employees','assets']
  loop
    execute format('drop policy if exists not_deleted on %I', t);
    execute format('create policy not_deleted on %I as restrictive for select to authenticated using (deleted_at is null)', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['catalog_items','terms_templates','sales_followups','asset_maintenance','sales_doc_revisions']
  loop
    execute format('drop trigger if exists audit_%1$s on %1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row()', t);
  end loop;
end $$;

-- ───────────── trash: soft delete / restore / purge ─────────────
create or replace function trash_table(p_entity text) returns text language sql immutable set search_path = public as $$
  select case p_entity when 'customer' then 'customers' when 'supplier' then 'suppliers' when 'project' then 'projects'
    when 'invoice' then 'invoices' when 'employee' then 'employees' when 'asset' then 'assets' when 'document' then 'documents' end
$$;

create or replace function soft_delete(p_entity text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tbl text := trash_table(p_entity); n int; st text;
begin
  if tbl is null then raise exception 'unknown entity %', p_entity; end if;
  if current_company_id() is null or not has_permission('records.delete') then raise exception 'insufficient privilege'; end if;
  if p_entity = 'invoice' then
    select status into st from invoices where id = p_id and company_id = current_company_id();
    if st is not null and st not in ('draft','cancelled') then raise exception 'only draft or cancelled documents can be moved to trash'; end if;
    if exists (select 1 from payments where invoice_id = p_id) then raise exception 'this document has payments'; end if;
  end if;
  execute format('update %I set deleted_at = now(), deleted_by = auth.uid() where id = $1 and company_id = $2 and deleted_at is null', tbl)
    using p_id, current_company_id();
  get diagnostics n = row_count;
  if n = 0 then raise exception 'record not found'; end if;
  insert into audit_logs(company_id, user_id, action, table_name, record_id, changes) values (current_company_id(), auth.uid(), 'TRASH', tbl, p_id, null);
end $$;

create or replace function restore_deleted(p_entity text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tbl text := trash_table(p_entity); n int;
begin
  if tbl is null then raise exception 'unknown entity %', p_entity; end if;
  if current_company_id() is null or not has_permission('records.delete') then raise exception 'insufficient privilege'; end if;
  execute format('update %I set deleted_at = null, deleted_by = null where id = $1 and company_id = $2 and deleted_at is not null', tbl)
    using p_id, current_company_id();
  get diagnostics n = row_count;
  if n = 0 then raise exception 'record not found'; end if;
  insert into audit_logs(company_id, user_id, action, table_name, record_id, changes) values (current_company_id(), auth.uid(), 'RESTORE', tbl, p_id, null);
end $$;

-- permanent delete: owners / super admins only, and only for items already in the trash
create or replace function purge_deleted(p_entity text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tbl text := trash_table(p_entity); n int;
begin
  if tbl is null or p_entity = 'document' then raise exception 'cannot purge %', p_entity; end if;   -- documents keep their own retention flow
  if current_company_id() is null or not has_permission('records.purge') then raise exception 'insufficient privilege'; end if;
  execute format('delete from %I where id = $1 and company_id = $2 and deleted_at is not null', tbl) using p_id, current_company_id();
  get diagnostics n = row_count;
  if n = 0 then raise exception 'record not found in trash'; end if;
  insert into audit_logs(company_id, user_id, action, table_name, record_id, changes) values (current_company_id(), auth.uid(), 'PURGE', tbl, p_id, null);
end $$;

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
    ) x order by 5 desc limit 500;
end $$;
revoke execute on function soft_delete(text, uuid), restore_deleted(text, uuid), purge_deleted(text, uuid), trash_list() from public, anon;
grant execute on function soft_delete(text, uuid), restore_deleted(text, uuid), purge_deleted(text, uuid), trash_list() to authenticated;

-- ───────────── reminders: follow-ups, inspections; soft-deleted records never remind ─────────────
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
  where f.done_at is null and i.deleted_at is null and i.status in ('sent','viewed','follow_up');

-- ───────────── atomic save: header + lines + revision snapshot in ONE transaction, with an edit-conflict check ─────────────
-- security invoker → the caller's RLS applies. Line ids are kept stable (update / insert / delete by id) so delivery notes stay linked.
create or replace function save_sales_doc(p_id uuid, p_head jsonb, p_items jsonb, p_expected text, p_revision jsonb)
returns timestamptz language plpgsql security invoker set search_path = public as $$
declare cur invoices; ts timestamptz := clock_timestamp();
begin
  select * into cur from invoices where id = p_id for update;
  if cur.id is null then raise exception 'document not found'; end if;
  if p_expected is not null and date_trunc('milliseconds', cur.updated_at) <> date_trunc('milliseconds', p_expected::timestamptz) then
    raise exception 'conflict: this document was changed by someone else' using errcode = 'P0409';
  end if;
  if p_revision is not null then
    insert into sales_doc_revisions(company_id, invoice_id, revision, snapshot, changes, created_by)
    values (cur.company_id, p_id, cur.revision, p_revision->'snapshot', array(select jsonb_array_elements_text(p_revision->'changes')), auth.uid());
  end if;
  update invoices set
    customer_id = nullif(p_head->>'customer_id','')::uuid, project_id = nullif(p_head->>'project_id','')::uuid,
    salesperson_id = nullif(p_head->>'salesperson_id','')::uuid,
    issue_date = (p_head->>'issue_date')::date, due_date = nullif(p_head->>'due_date','')::date, valid_until = nullif(p_head->>'valid_until','')::date,
    attention = p_head->>'attention', customer_name = p_head->>'customer_name', customer_address = p_head->>'customer_address',
    customer_trn = p_head->>'customer_trn', customer_phone = p_head->>'customer_phone', customer_email = p_head->>'customer_email',
    site = p_head->>'site', subject = p_head->>'subject', reference = p_head->>'reference', lpo_ref = p_head->>'lpo_ref',
    intro = p_head->>'intro', closing = p_head->>'closing', receiver_name = p_head->>'receiver_name', vehicle_no = p_head->>'vehicle_no', notes = p_head->>'notes',
    vat_rate = (p_head->>'vat_rate')::numeric, discount_type = coalesce(p_head->>'discount_type','amount'), discount_value = coalesce((p_head->>'discount_value')::numeric, 0),
    discount = (p_head->>'discount')::numeric, show_total = coalesce((p_head->>'show_total')::boolean, true), apply_vat = (p_head->>'apply_vat')::boolean,
    terms = array(select jsonb_array_elements_text(coalesce(p_head->'terms','[]'))), payment_terms = array(select jsonb_array_elements_text(coalesce(p_head->'payment_terms','[]'))),
    subtotal = (p_head->>'subtotal')::numeric, vat_amount = (p_head->>'vat_amount')::numeric, total = (p_head->>'total')::numeric,
    revision = case when p_revision is not null then cur.revision + 1 else cur.revision end,
    updated_at = ts
  where id = p_id;

  delete from invoice_items where invoice_id = p_id
    and id not in (select (x->>'id')::uuid from jsonb_array_elements(p_items) x where coalesce(x->>'id','') <> '');
  update invoice_items t set position = r.position, description = r.description, materials = r.materials, quantity = r.quantity, unit = r.unit,
         unit_price = r.unit_price, vat_category = r.vat_category, discount_pct = r.discount_pct, catalog_item_id = r.catalog_item_id
    from jsonb_to_recordset(p_items) as r(id uuid, position int, description text, materials text, quantity numeric, unit text, unit_price numeric, vat_category text, discount_pct numeric, source_item_id uuid, catalog_item_id uuid)
    where t.id = r.id and t.invoice_id = p_id;
  insert into invoice_items(company_id, invoice_id, position, description, materials, quantity, unit, unit_price, vat_category, discount_pct, source_item_id, catalog_item_id)
    select cur.company_id, p_id, r.position, r.description, r.materials, r.quantity, r.unit, r.unit_price, r.vat_category, r.discount_pct, r.source_item_id, r.catalog_item_id
    from jsonb_to_recordset(p_items) as r(id uuid, position int, description text, materials text, quantity numeric, unit text, unit_price numeric, vat_category text, discount_pct numeric, source_item_id uuid, catalog_item_id uuid)
    where r.id is null or not exists (select 1 from invoice_items x where x.id = r.id and x.invoice_id = p_id);
  return ts;
end $$;
revoke execute on function save_sales_doc(uuid, jsonb, jsonb, text, jsonb) from public, anon;
grant execute on function save_sales_doc(uuid, jsonb, jsonb, text, jsonb) to authenticated;

-- ───────────── project team ─────────────
create table if not exists project_members (
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  role text check (length(role) <= 80),
  assigned_on date not null default current_date,
  primary key (project_id, employee_id)
);
alter table project_members enable row level security;
create policy pm_select on project_members for select to authenticated using (company_id = current_company_id() and has_permission('documents.view'));
create policy pm_insert on project_members for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit'));
create policy pm_update on project_members for update to authenticated using (company_id = current_company_id() and has_permission('records.edit')) with check (company_id = current_company_id());
create policy pm_delete on project_members for delete to authenticated using (company_id = current_company_id() and has_permission('records.edit'));
create index if not exists project_members_employee_idx on project_members(employee_id);
create index if not exists documents_owner_created_idx on documents(company_id, owner_type, owner_id, created_at desc) where deleted_at is null;
