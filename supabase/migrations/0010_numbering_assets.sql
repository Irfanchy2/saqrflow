-- 0010: configurable document numbering (AS00{seq}/{year} for quotations), Vehicles & Assets fields, asset reminders.
-- Additive only. Existing invoice / quotation numbers are never rewritten.

-- ───────────── numbering engine ─────────────
-- One row per company + document type that uses a custom format. No row → the original format (QTN-YYYY-0001, INV-…).
create table document_number_formats (
  company_id uuid not null references companies(id) on delete cascade,
  doc_type text not null check (doc_type in ('quotation','invoice','delivery_note','purchase_order','credit_note','receipt')),
  prefix text not null check (prefix ~ '^[A-Za-z0-9-]{0,12}$'),          -- "AS"
  fixed_digits text not null default '' check (fixed_digits ~ '^[0-9]{0,6}$'),  -- "00"
  seq_pad int not null default 5 check (seq_pad between 1 and 10),        -- minimum digits of the running number
  next_seq bigint not null check (next_seq > 0),                          -- next running number to issue (25180 → AS0025180/2026)
  year_separator text not null default '/' check (year_separator in ('/','-','')),
  yearly_reset boolean not null default false,                            -- false: the running number continues across years
  reset_to bigint not null default 1 check (reset_to > 0),
  last_year int,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, doc_type)
);
alter table document_number_formats enable row level security;
create policy dnf_select on document_number_formats for select to authenticated using (company_id = current_company_id());
create policy dnf_insert on document_number_formats for insert to authenticated with check (company_id = current_company_id() and has_permission('settings.manage'));
create policy dnf_update on document_number_formats for update to authenticated using (company_id = current_company_id() and has_permission('settings.manage')) with check (company_id = current_company_id());
create policy dnf_delete on document_number_formats for delete to authenticated using (company_id = current_company_id() and has_permission('settings.manage'));
create trigger audit_document_number_formats after insert or update or delete on document_number_formats for each row execute function audit_row();

-- every existing company starts quotations in the AS00…/YYYY format (editable in Settings → Document numbering)
insert into document_number_formats(company_id, doc_type, prefix, fixed_digits, seq_pad, next_seq)
  select id, 'quotation', 'AS', '00', 5, 25180 from companies
  on conflict do nothing;

-- pure formatter (also used for the Settings preview)
create or replace function format_document_number(p_prefix text, p_fixed text, p_pad int, p_seq bigint, p_sep text, p_year int)
returns text language sql immutable as $$
  select p_prefix || p_fixed || lpad(p_seq::text, greatest(p_pad, length(p_seq::text)), '0') || p_sep || p_year::text
$$;

create or replace function next_document_number(p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare cid uuid := current_company_id(); yr int; n bigint; prefix text; f document_number_formats; num text;
begin
  if cid is null or not has_permission('records.edit') then raise exception 'insufficient privilege'; end if;
  prefix := case p_doc_type when 'quotation' then 'QTN' when 'invoice' then 'INV' when 'delivery_note' then 'DN'
    when 'purchase_order' then 'PO' when 'credit_note' then 'CN' when 'receipt' then 'RCT' else null end;
  if prefix is null then raise exception 'unknown document type %', p_doc_type; end if;
  select extract(year from (now() at time zone c.timezone))::int into yr from companies c where c.id = cid;

  -- custom format: row lock serialises concurrent callers → no duplicates
  select * into f from document_number_formats where company_id = cid and doc_type = p_doc_type for update;
  if found then
    if f.yearly_reset and f.last_year is not null and f.last_year <> yr then f.next_seq := f.reset_to; end if;
    loop
      num := format_document_number(f.prefix, f.fixed_digits, f.seq_pad, f.next_seq, f.year_separator, yr);
      f.next_seq := f.next_seq + 1;
      exit when not exists (select 1 from invoices i where i.company_id = cid and i.doc_type = p_doc_type and i.number = num);
    end loop;
    update document_number_formats set next_seq = f.next_seq, last_year = yr where company_id = cid and doc_type = p_doc_type;
    return num;
  end if;

  -- original format (unchanged)
  insert into document_counters(company_id, doc_type, year, last) values (cid, p_doc_type, yr, 1)
    on conflict (company_id, doc_type, year) do update set last = document_counters.last + 1
    returning last into n;
  return prefix || '-' || yr || '-' || lpad(n::text, 4, '0');
end $$;
revoke all on function next_document_number(text) from public, anon;
grant execute on function next_document_number(text) to authenticated;

-- new companies get the AS format too
create or replace function seed_number_formats() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into document_number_formats(company_id, doc_type, prefix, fixed_digits, seq_pad, next_seq) values (new.id, 'quotation', 'AS', '00', 5, 25180) on conflict do nothing;
  return new;
end $$;
create trigger companies_seed_number_formats after insert on companies for each row execute function seed_number_formats();
revoke execute on function seed_number_formats() from public, anon, authenticated;

-- per-document contact e-mail (snapshot; editing it never changes the customer master)
alter table invoices add column if not exists customer_email text;

-- ───────────── Vehicles & Assets ─────────────
alter table assets drop constraint if exists assets_kind_check;
alter table assets add constraint assets_kind_check check (kind in ('vehicle','equipment','machinery','tool','office','other'));
alter table assets
  add column if not exists category text,                -- Welding Machine, Generator, Compressor…
  add column if not exists asset_code text,              -- internal Asset ID
  add column if not exists serial_no text,
  add column if not exists plate_emirate text,
  add column if not exists vehicle_type text,            -- Pickup, Truck, Van, Car, Bus, Forklift…
  add column if not exists make text,
  add column if not exists model text,
  add column if not exists model_year int check (model_year is null or model_year between 1950 and 2100),
  add column if not exists mulkiya_no text,
  add column if not exists insurance_provider text,
  add column if not exists purchase_date date,
  add column if not exists purchase_price numeric(14,2) check (purchase_price is null or purchase_price >= 0),
  add column if not exists supplier_id uuid references suppliers(id) on delete set null,
  add column if not exists supplier_name text,
  add column if not exists location text,
  add column if not exists status text not null default 'active',
  add column if not exists archived_at timestamptz,
  add column if not exists created_by uuid references profiles(id),
  add column if not exists updated_at timestamptz not null default now();
alter table assets drop constraint if exists assets_status_check;
alter table assets add constraint assets_status_check check (status in ('active','in_maintenance','out_of_service','sold','disposed'));
create unique index if not exists assets_code_uidx on assets(company_id, asset_code) where asset_code is not null;
create index if not exists assets_company_kind_idx on assets(company_id, kind, archived_at);
create index if not exists assets_company_name_idx on assets(company_id, lower(name));

-- ───────────── reminders: vehicle / asset expiries join the existing reminder engine ─────────────
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
  where not m.done and p.status not in ('completed','cancelled')
  union all
  select a.company_id, x.kind, a.id, x.label || ' – ' || a.name, coalesce(a.plate_or_serial, a.asset_code), x.label, 'asset', x.due, null::int[], null, null, '/assets/' || a.id
  from assets a
  cross join lateral (values
    ('asset_registration', case when a.kind = 'vehicle' then 'Mulkiya / registration' else 'Registration' end, a.registration_expiry),
    ('asset_insurance', 'Insurance', a.insurance_expiry),
    ('asset_warranty', 'Warranty', a.warranty_expiry),
    ('asset_service', 'Maintenance', a.next_service_date)) as x(kind, label, due)
  where x.due is not null and a.archived_at is null and a.status not in ('sold','disposed');
