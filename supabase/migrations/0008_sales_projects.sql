-- Sales documents (quotation / tax invoice / delivery note), payments and projects.
-- Additive: extends the existing invoices / payments / projects tables (created empty in 0001) instead of duplicating them.

-- ───────────── sales documents ─────────────
alter table invoices drop constraint if exists invoices_doc_type_check;
alter table invoices add constraint invoices_doc_type_check check (doc_type in ('quotation','invoice','delivery_note','purchase_order','credit_note','receipt'));
alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check check (status in ('draft','sent','accepted','rejected','expired','partially_paid','paid','overdue','cancelled','delivered'));
alter table invoices
  add column if not exists attention text,
  add column if not exists customer_name text,          -- snapshot printed on the document
  add column if not exists customer_address text,
  add column if not exists customer_trn text,
  add column if not exists customer_phone text,
  add column if not exists reference text,
  add column if not exists closing text,
  add column if not exists site text,                   -- working place / delivery location
  add column if not exists subject text,
  add column if not exists intro text,
  add column if not exists lpo_ref text,
  add column if not exists valid_until date,
  add column if not exists vat_amount numeric(14,2) not null default 0,
  add column if not exists discount numeric(14,2) not null default 0 check (discount >= 0),
  add column if not exists show_total boolean not null default true,
  add column if not exists terms text[] not null default '{}',
  add column if not exists payment_terms text[] not null default '{}',
  add column if not exists quotation_id uuid references invoices(id) on delete set null,   -- invoice/DN created from this quotation
  add column if not exists source_invoice_id uuid references invoices(id) on delete set null, -- DN created from this invoice
  add column if not exists receiver_name text,
  add column if not exists vehicle_no text,
  add column if not exists pdf_document_id uuid references documents(id) on delete set null,
  add column if not exists created_by uuid references profiles(id),
  add column if not exists updated_at timestamptz not null default now(),
  -- ready for external accounting-software sync (Phase 2 of the integration plan)
  add column if not exists external_provider text,
  add column if not exists external_record_id text,
  add column if not exists external_synced_at timestamptz;
create unique index if not exists invoices_external_uidx on invoices(company_id, external_provider, external_record_id) where external_record_id is not null;
create index if not exists invoices_company_type_idx on invoices(company_id, doc_type, issue_date desc);
create index if not exists invoices_customer_idx on invoices(company_id, customer_id);
create index if not exists invoices_project_idx on invoices(company_id, project_id);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  position int not null default 0,
  description text not null check (length(description) between 1 and 2000),
  materials text,
  quantity numeric(14,3) not null default 1 check (quantity >= 0),
  unit text not null default 'Nos',
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);
create index invoice_items_invoice_idx on invoice_items(invoice_id, position);
alter table invoice_items enable row level security;
create policy ii_select on invoice_items for select to authenticated using (
  company_id = current_company_id() and exists (select 1 from invoices i where i.id = invoice_id));
create policy ii_insert on invoice_items for insert to authenticated with check (
  company_id = current_company_id() and has_permission('records.edit') and exists (select 1 from invoices i where i.id = invoice_id));
create policy ii_update on invoice_items for update to authenticated using (
  company_id = current_company_id() and has_permission('records.edit')) with check (company_id = current_company_id());
create policy ii_delete on invoice_items for delete to authenticated using (
  company_id = current_company_id() and has_permission('records.edit'));

-- gap-free per-company, per-type, per-year numbering: QTN-2026-0001, INV-2026-0001, DN-2026-0001
create table document_counters (
  company_id uuid not null references companies(id) on delete cascade,
  doc_type text not null, year int not null, last int not null default 0,
  primary key (company_id, doc_type, year)
);
alter table document_counters enable row level security;   -- only via next_document_number()

create or replace function next_document_number(p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare cid uuid := current_company_id(); yr int; n int; prefix text;
begin
  if cid is null or not has_permission('records.edit') then raise exception 'insufficient privilege'; end if;
  prefix := case p_doc_type when 'quotation' then 'QTN' when 'invoice' then 'INV' when 'delivery_note' then 'DN'
    when 'purchase_order' then 'PO' when 'credit_note' then 'CN' when 'receipt' then 'RCT' else null end;
  if prefix is null then raise exception 'unknown document type %', p_doc_type; end if;
  select extract(year from (now() at time zone c.timezone))::int into yr from companies c where c.id = cid;
  insert into document_counters(company_id, doc_type, year, last) values (cid, p_doc_type, yr, 1)
    on conflict (company_id, doc_type, year) do update set last = document_counters.last + 1
    returning last into n;
  return prefix || '-' || yr || '-' || lpad(n::text, 4, '0');
end $$;
revoke all on function next_document_number(text) from public, anon;
grant execute on function next_document_number(text) to authenticated;

-- ───────────── payments → invoice status ─────────────
alter table payments add column if not exists reference text, add column if not exists customer_id uuid references customers(id) on delete set null,
  add column if not exists created_by uuid references profiles(id);
alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check check (method in ('cash','bank_transfer','cheque','card','pdc','other'));
create index if not exists payments_invoice_idx on payments(invoice_id);

create view invoice_balances with (security_invoker = true) as
  select i.id, i.company_id, i.total, coalesce(sum(p.amount), 0)::numeric(14,2) as paid,
         (i.total - coalesce(sum(p.amount), 0))::numeric(14,2) as balance
  from invoices i left join payments p on p.invoice_id = i.id
  group by i.id;

create or replace function refresh_invoice_status(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv record; paid numeric; today date;
begin
  select i.*, c.timezone into inv from invoices i join companies c on c.id = i.company_id where i.id = p_invoice;
  if inv is null or inv.doc_type <> 'invoice' or inv.status in ('draft','cancelled') then return; end if;
  select coalesce(sum(amount), 0) into paid from payments where invoice_id = p_invoice;
  today := (now() at time zone inv.timezone)::date;
  update invoices set status = case
      when inv.total > 0 and paid >= inv.total then 'paid'
      when paid > 0 then 'partially_paid'
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
  if other + new.amount > inv.total + 0.005 then
    raise exception 'payment exceeds the invoice balance (balance %)', round(inv.total - other, 2);
  end if;
  new.customer_id := coalesce(new.customer_id, inv.customer_id);
  return new;
end $$;
create trigger payments_guard_t before insert or update on payments for each row execute function payments_guard();

create or replace function payments_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' and old.invoice_id is not null then perform refresh_invoice_status(old.invoice_id); end if;
  if tg_op <> 'DELETE' and new.invoice_id is not null then perform refresh_invoice_status(new.invoice_id); end if;
  return null;
end $$;
create trigger payments_after_t after insert or update or delete on payments for each row execute function payments_after();

-- daily: sent invoices past their due date become overdue (called by the scheduler)
create or replace function mark_overdue_invoices() returns int
language sql security definer set search_path = public as $$
  with u as (
    update invoices i set status = 'overdue', updated_at = now()
    from companies c
    where c.id = i.company_id and i.doc_type = 'invoice' and i.status = 'sent'
      and i.due_date < (now() at time zone c.timezone)::date
    returning 1)
  select count(*)::int from u
$$;
revoke all on function mark_overdue_invoices() from public, anon, authenticated;
grant execute on function mark_overdue_invoices() to service_role;
revoke execute on function refresh_invoice_status(uuid), payments_guard(), payments_after() from public, anon, authenticated;

-- ───────────── projects ─────────────
alter table projects
  add column if not exists code text,
  add column if not exists description text,
  add column if not exists fabrication_progress int not null default 0 check (fabrication_progress between 0 and 100),
  add column if not exists site_progress int not null default 0 check (site_progress between 0 and 100),
  add column if not exists updated_at timestamptz not null default now();
create index if not exists projects_company_status_idx on projects(company_id, status);

create table project_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  spent_on date not null default current_date,
  category text not null check (category in ('material','labour','transport','subcontract','equipment','other')),
  supplier_id uuid references suppliers(id) on delete set null,
  description text not null check (length(description) between 1 and 500),
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index project_expenses_project_idx on project_expenses(project_id, spent_on desc);

create table project_milestones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  due_date date not null,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index project_milestones_project_idx on project_milestones(project_id, due_date);

do $$ begin
  perform apply_standard_rls('project_expenses', 'finance.view', 'records.edit');
  perform apply_standard_rls('project_milestones', 'documents.view', 'records.edit');
end $$;

do $$ declare t text; begin
  foreach t in array array['invoice_items','project_expenses','project_milestones']
  loop execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row()', t); end loop;
end $$;

-- ───────────── reminders: add project milestones; invoices remind on the outstanding balance ─────────────
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
  where i.doc_type = 'invoice' and i.status in ('sent','partially_paid','overdue') and i.due_date is not null and b.balance > 0
  union all
  select m.company_id, 'milestone', m.id, m.title, p.name, 'Project milestone', 'project', m.due_date, array[7,3,1,0], null, null, '/projects/' || m.project_id
  from project_milestones m join projects p on p.id = m.project_id
  where not m.done and p.status not in ('completed','cancelled');
