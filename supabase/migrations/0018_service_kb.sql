-- 0018: warranties, service tickets (with timeline) and the internal Knowledge Base / SOPs. Additive only.
-- Tickets and warranties use the shared numbering (ST-… / WR-…), soft delete (Trash) and the audit log like other records.

-- ───────────── warranties ─────────────
create table if not exists warranties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number text not null,
  customer_id uuid references customers(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  title text not null check (length(title) between 1 and 200),          -- what is covered, e.g. "Staircase structure and welds"
  terms text check (length(terms) <= 4000),
  start_date date not null,
  end_date date not null,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid references profiles(id),
  unique (company_id, number),
  check (end_date >= start_date)
);
create index if not exists warranties_customer_idx on warranties(company_id, customer_id);

-- ───────────── service tickets ─────────────
create table if not exists service_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number text not null,
  title text not null check (length(title) between 1 and 200),
  description text check (length(description) <= 4000),
  category text not null default 'repair' check (category in ('repair','maintenance','installation_defect','inspection','complaint','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','scheduled','in_progress','waiting_customer','resolved','closed','cancelled')),
  source text not null default 'internal' check (source in ('internal','phone','whatsapp','email','walk_in','form','portal')),
  customer_id uuid references customers(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  warranty_id uuid references warranties(id) on delete set null,
  under_warranty boolean not null default false,
  chargeable boolean not null default false,
  contact_name text check (length(contact_name) <= 120),
  contact_phone text check (length(contact_phone) <= 40),
  site_location text check (length(site_location) <= 300),
  assigned_to uuid references profiles(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  scheduled_date date,
  due_date date,
  resolution text check (length(resolution) <= 4000),
  resolved_at timestamptz, closed_at timestamptz,
  client_token uuid,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid references profiles(id),
  unique (company_id, number)
);
create index if not exists service_tickets_open_idx on service_tickets(company_id, status, due_date);
create unique index if not exists service_tickets_token_uidx on service_tickets(company_id, client_token) where client_token is not null;

create table if not exists ticket_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  ticket_id uuid not null references service_tickets(id) on delete cascade,
  kind text not null check (kind in ('created','note','status','assigned','customer')),
  body text not null check (length(body) between 1 and 4000),
  user_id uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists ticket_events_ticket_idx on ticket_events(ticket_id, created_at);

-- warranty check + default due date (SLA by priority) when a ticket is opened; timestamps on resolve / close
create or replace function service_ticket_defaults() returns trigger language plpgsql security definer set search_path = public as $$
declare today date; w uuid;
begin
  select (now() at time zone c.timezone)::date into today from companies c where c.id = new.company_id;
  if tg_op = 'INSERT' then
    if new.warranty_id is null and (new.customer_id is not null or new.project_id is not null) then
      select x.id into w from warranties x where x.company_id = new.company_id and x.deleted_at is null and today between x.start_date and x.end_date
        and ((new.project_id is not null and x.project_id = new.project_id) or (new.customer_id is not null and x.customer_id = new.customer_id))
        order by (x.project_id is not distinct from new.project_id) desc, x.end_date desc limit 1;
      new.warranty_id := w;
    end if;
    if new.warranty_id is not null then
      new.under_warranty := exists (select 1 from warranties x where x.id = new.warranty_id and x.company_id = new.company_id and today between x.start_date and x.end_date);
    end if;
    if new.due_date is null then new.due_date := today + case new.priority when 'urgent' then 1 when 'high' then 2 when 'low' then 10 else 5 end; end if;
  end if;
  if new.status in ('resolved','closed') and new.resolved_at is null then new.resolved_at := now(); end if;
  if new.status = 'closed' and new.closed_at is null then new.closed_at := now(); end if;
  if new.status not in ('resolved','closed') then new.resolved_at := null; new.closed_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger service_ticket_defaults_t before insert or update on service_tickets for each row execute function service_ticket_defaults();

-- ───────────── knowledge base / SOPs ─────────────
create table if not exists kb_articles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  category text not null default 'General' check (length(category) between 1 and 60),
  body text not null default '' check (length(body) <= 60000),
  tags text[] not null default '{}',
  status text not null default 'published' check (status in ('draft','published')),
  pinned boolean not null default false,
  version int not null default 1,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid references profiles(id),
  check (cardinality(tags) <= 12)
);
create index if not exists kb_articles_company_idx on kb_articles(company_id, category, title);
create table if not exists kb_article_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  article_id uuid not null references kb_articles(id) on delete cascade,
  version int not null,
  title text not null, body text not null,
  edited_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (article_id, version)
);
-- every content change keeps the previous version (who / when / what)
create or replace function kb_keep_version() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.title is distinct from old.title or new.body is distinct from old.body then
    insert into kb_article_versions(company_id, article_id, version, title, body, edited_by, created_at)
      values (old.company_id, old.id, old.version, old.title, old.body, old.updated_by, old.updated_at) on conflict do nothing;
    new.version := old.version + 1;
  end if;
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger kb_keep_version_t before update on kb_articles for each row execute function kb_keep_version();

-- ───────────── security ─────────────
alter table warranties enable row level security;
create policy wr_select on warranties for select to authenticated using (company_id = current_company_id() and has_permission('documents.view'));
create policy wr_insert on warranties for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit'));
create policy wr_update on warranties for update to authenticated using (company_id = current_company_id() and has_permission('records.edit')) with check (company_id = current_company_id());

alter table service_tickets enable row level security;
-- office staff see all tickets; a technician without wider access sees (and updates) the tickets assigned to them
create policy st_select on service_tickets for select to authenticated using (company_id = current_company_id() and (has_permission('documents.view') or assigned_to = auth.uid()));
create policy st_insert on service_tickets for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit'));
create policy st_update on service_tickets for update to authenticated using (company_id = current_company_id() and (has_permission('records.edit') or assigned_to = auth.uid())) with check (company_id = current_company_id());

alter table ticket_events enable row level security;
create policy te_select on ticket_events for select to authenticated using (company_id = current_company_id() and exists (select 1 from service_tickets t where t.id = ticket_id));
create policy te_insert on ticket_events for insert to authenticated with check (company_id = current_company_id() and user_id = auth.uid() and exists (select 1 from service_tickets t where t.id = ticket_id));

alter table kb_articles enable row level security;
-- every signed-in member of the company can read published articles (SOPs are for the whole team); editors also see drafts
create policy kb_select on kb_articles for select to authenticated using (company_id = current_company_id() and (status = 'published' or has_permission('records.edit')));
create policy kb_insert on kb_articles for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit'));
create policy kb_update on kb_articles for update to authenticated using (company_id = current_company_id() and has_permission('records.edit')) with check (company_id = current_company_id());
alter table kb_article_versions enable row level security;
create policy kbv_select on kb_article_versions for select to authenticated using (company_id = current_company_id() and has_permission('records.edit'));

-- trashed rows disappear from every query (same restrictive policy as the other soft-deleted tables)
create policy not_deleted on warranties as restrictive for select to authenticated using (deleted_at is null);
create policy not_deleted on service_tickets as restrictive for select to authenticated using (deleted_at is null);
create policy not_deleted on kb_articles as restrictive for select to authenticated using (deleted_at is null);

create trigger audit_warranties after insert or update or delete on warranties for each row execute function audit_row();
create trigger audit_service_tickets after insert or update or delete on service_tickets for each row execute function audit_row();
create trigger audit_kb_articles after insert or update or delete on kb_articles for each row execute function audit_row();

-- ───────────── numbering: ST- (service ticket), WR- (warranty) ─────────────
create or replace function issue_document_number(cid uuid, p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare yr int; n bigint; prefix text; f document_number_formats; num text;
begin
  if cid is null then raise exception 'company required'; end if;
  prefix := case p_doc_type when 'quotation' then 'QTN' when 'invoice' then 'INV' when 'delivery_note' then 'DN'
    when 'purchase_order' then 'PO' when 'credit_note' then 'CN' when 'receipt' then 'RCT' when 'project' then 'PRJ'
    when 'lead' then 'LD' when 'site_visit' then 'SV' when 'work_order' then 'WO' when 'site_report' then 'DSR'
    when 'service_ticket' then 'ST' when 'warranty' then 'WR' else null end;
  if prefix is null then raise exception 'unknown document type %', p_doc_type; end if;
  select extract(year from (now() at time zone c.timezone))::int into yr from companies c where c.id = cid;
  select * into f from document_number_formats where company_id = cid and doc_type = p_doc_type for update;
  if found then
    if f.yearly_reset and f.last_year is not null and f.last_year <> yr then f.next_seq := f.reset_to; end if;
    loop
      num := format_document_number_v2(f.prefix, f.number_separator, f.fixed_digits, f.seq_pad, f.next_seq, f.year_separator, f.year_format, case when f.include_year then yr end);
      f.next_seq := f.next_seq + 1;
      exit when not (case p_doc_type
        when 'project' then exists (select 1 from projects p where p.company_id = cid and p.code = num)
        when 'lead' then exists (select 1 from leads x where x.company_id = cid and x.number = num)
        when 'site_visit' then exists (select 1 from site_visits x where x.company_id = cid and x.number = num)
        when 'work_order' then exists (select 1 from work_orders x where x.company_id = cid and x.number = num)
        when 'site_report' then exists (select 1 from daily_site_reports x where x.company_id = cid and x.number = num)
        when 'service_ticket' then exists (select 1 from service_tickets x where x.company_id = cid and x.number = num)
        when 'warranty' then exists (select 1 from warranties x where x.company_id = cid and x.number = num)
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
revoke all on function issue_document_number(uuid, text) from public, anon, authenticated;
grant execute on function issue_document_number(uuid, text) to service_role;

-- ───────────── trash ─────────────
create or replace function trash_table(p_entity text) returns text language sql immutable set search_path = public as $$
  select case p_entity when 'customer' then 'customers' when 'supplier' then 'suppliers' when 'project' then 'projects'
    when 'invoice' then 'invoices' when 'employee' then 'employees' when 'asset' then 'assets' when 'document' then 'documents'
    when 'lead' then 'leads' when 'site_visit' then 'site_visits' when 'work_order' then 'work_orders' when 'task' then 'tasks'
    when 'site_report' then 'daily_site_reports' when 'service_ticket' then 'service_tickets' when 'warranty' then 'warranties'
    when 'kb_article' then 'kb_articles' end
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
      union all select 'service_ticket', s.id, s.number || ' · ' || s.title, coalesce(s.contact_name, ''), s.deleted_at, s.deleted_by from service_tickets s where s.company_id = cid and s.deleted_at is not null
      union all select 'warranty', w.id, w.number || ' · ' || w.title, w.start_date::text || ' – ' || w.end_date::text, w.deleted_at, w.deleted_by from warranties w where w.company_id = cid and w.deleted_at is not null
      union all select 'kb_article', k.id, k.title, k.category, k.deleted_at, k.deleted_by from kb_articles k where k.company_id = cid and k.deleted_at is not null
    ) x order by 5 desc limit 500;
end $$;
revoke execute on function trash_list() from public, anon;
grant execute on function trash_list() to authenticated;

-- public service-request forms create tickets (enquiry forms keep creating leads)
alter table public_form_submissions add column if not exists ticket_id uuid references service_tickets(id) on delete set null;
