-- 0017: secure external links (customer portal, supplier portal, document requests, quotation accept / reject) and public
-- enquiry / service-request forms. Additive only. Tokens are never stored: only their SHA-256 hash. Everything a link may
-- show is read on the server with an explicit company + record filter after the hash, expiry and revocation are checked.

create table if not exists share_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('customer_portal','supplier_portal','document_request','quote_response')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  customer_id uuid references customers(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  title text check (length(title) <= 200),
  message text check (length(message) <= 2000),
  items text[] not null default '{}',                 -- document request: what is being asked for
  recipient_name text check (length(recipient_name) <= 120),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count int not null default 0,
  check (expires_at <= created_at + interval '366 days'),
  check (cardinality(items) <= 20),
  check (case kind when 'customer_portal' then customer_id is not null
                   when 'supplier_portal' then supplier_id is not null
                   when 'quote_response' then invoice_id is not null
                   else num_nonnulls(customer_id, supplier_id, employee_id) = 1 end)
);
create index if not exists share_links_company_idx on share_links(company_id, created_at desc);
alter table share_links enable row level security;
create or replace function share_link_perm_ok(k text) returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('records.edit') and (k = 'document_request' or has_permission('finance.view'))
$$;
create policy sl_select on share_links for select to authenticated using (company_id = current_company_id() and share_link_perm_ok(kind));
create policy sl_insert on share_links for insert to authenticated with check (company_id = current_company_id() and share_link_perm_ok(kind));
create policy sl_update on share_links for update to authenticated using (company_id = current_company_id() and share_link_perm_ok(kind)) with check (company_id = current_company_id());
create trigger audit_share_links after insert or update or delete on share_links for each row execute function audit_row();

-- what happened through a link (written by the server only); also used for rate limiting
create table if not exists share_link_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  link_id uuid not null references share_links(id) on delete cascade,
  event text not null check (event in ('opened','downloaded','uploaded','accepted','rejected','delivery_confirmed','invoice_uploaded')),
  detail text check (length(detail) <= 500),
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists share_link_events_link_idx on share_link_events(link_id, created_at desc);
alter table share_link_events enable row level security;
create policy sle_select on share_link_events for select to authenticated using (company_id = current_company_id() and has_permission('records.edit'));

-- purchase orders can be addressed to a supplier (supplier portal) and confirmed by them
alter table invoices add column if not exists supplier_id uuid references suppliers(id) on delete set null;
alter table invoices add column if not exists supplier_confirmed_at timestamptz;
alter table invoices add column if not exists supplier_confirmation jsonb;
create index if not exists invoices_supplier_idx on invoices(company_id, supplier_id) where supplier_id is not null;

-- ───────────── public forms (website enquiry / service request) ─────────────
create table if not exists public_forms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  kind text not null default 'enquiry' check (kind in ('enquiry','service_request')),
  title text not null check (length(title) between 1 and 120),
  intro text check (length(intro) <= 1000),
  enabled boolean not null default true,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public_forms enable row level security;
create policy pf_select on public_forms for select to authenticated using (company_id = current_company_id());
create policy pf_write on public_forms for all to authenticated using (company_id = current_company_id() and has_permission('settings.manage')) with check (company_id = current_company_id() and has_permission('settings.manage'));
create trigger audit_public_forms after insert or update or delete on public_forms for each row execute function audit_row();

create table if not exists public_form_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  form_id uuid not null references public_forms(id) on delete cascade,
  ip_hash text not null,
  lead_id uuid references leads(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists public_form_submissions_rate_idx on public_form_submissions(form_id, ip_hash, created_at desc);
alter table public_form_submissions enable row level security;
create policy pfs_select on public_form_submissions for select to authenticated using (company_id = current_company_id() and has_permission('crm.view'));

-- ───────────── numbering for server-side (public) inserts ─────────────
-- Same rules as next_document_number, for a given company. Only the service role may call it (public forms run there,
-- after their own checks); signed-in users keep using next_document_number, which checks their permission first.
create or replace function issue_document_number(cid uuid, p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare yr int; n bigint; prefix text; f document_number_formats; num text;
begin
  if cid is null then raise exception 'company required'; end if;
  prefix := case p_doc_type when 'quotation' then 'QTN' when 'invoice' then 'INV' when 'delivery_note' then 'DN'
    when 'purchase_order' then 'PO' when 'credit_note' then 'CN' when 'receipt' then 'RCT' when 'project' then 'PRJ'
    when 'lead' then 'LD' when 'site_visit' then 'SV' when 'work_order' then 'WO' when 'site_report' then 'DSR' else null end;
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

create or replace function next_document_number(p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if current_company_id() is null or not has_permission('records.edit') then raise exception 'insufficient privilege'; end if;
  return issue_document_number(current_company_id(), p_doc_type);
end $$;
revoke all on function next_document_number(text) from public, anon;
grant execute on function next_document_number(text) to authenticated;
