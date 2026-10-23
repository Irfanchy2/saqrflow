-- Expenses: supplier purchases, receipt scanning with review, verification, duplicate checks and Tally export batches.
-- Additive only: new columns (with defaults), new tables, new functions and triggers. No existing row is deleted, and
-- existing values are not changed (payment_status starts as 'unpaid' only for rows already paid "on credit").

-- ───────────── expense columns ─────────────
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'project_expenses' and column_name = 'payment_status') then
    alter table project_expenses add column payment_status text not null default 'paid' check (payment_status in ('paid','unpaid'));
    -- first time only: an expense recorded as bought on credit has not been paid yet
    update project_expenses set payment_status = 'unpaid' where payment_method = 'credit';
  end if;
end $$;

alter table project_expenses
  add column if not exists supplier_trn text check (supplier_trn is null or supplier_trn ~ '^[0-9]{15}$'),
  add column if not exists quantity numeric(14,3) check (quantity is null or quantity > 0),
  add column if not exists vat_rate numeric(5,2) check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100)),
  add column if not exists payment_ref text check (length(payment_ref) <= 120),
  add column if not exists items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200),
  add column if not exists source text not null default 'manual' check (source in ('manual','scan')),
  add column if not exists ocr_suggested jsonb,            -- what the scan suggested, kept next to what the person saved
  add column if not exists verified_at timestamptz,        -- the person who saved it checked it against the receipt
  add column if not exists verified_by uuid references profiles(id) on delete set null,
  add column if not exists export_batch_id uuid,
  add column if not exists exported_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists project_expenses_dup_idx on project_expenses(company_id, supplier_id, lower(reference)) where reference is not null;
create index if not exists project_expenses_dupname_idx on project_expenses(company_id, lower(supplier_name), lower(reference)) where reference is not null;
create index if not exists project_expenses_supplier_idx on project_expenses(company_id, supplier_id, spent_on desc);
create index if not exists project_expenses_export_idx on project_expenses(company_id, export_batch_id, spent_on);

alter table suppliers add column if not exists tally_ledger text check (length(tally_ledger) <= 200);

-- ───────────── export batches ─────────────
create table if not exists expense_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  ref text not null,
  format text not null default 'tally_xml' check (format in ('tally_xml')),
  tally_version text check (length(tally_version) <= 60),
  filters jsonb not null default '{}'::jsonb,
  expense_count int not null check (expense_count > 0),
  total numeric(16,2) not null,
  vat_total numeric(16,2) not null,
  file_name text not null,
  content text not null check (length(content) <= 20000000),   -- the exact file handed out, so a re-download is identical
  checksum text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references profiles(id) on delete set null,
  release_reason text check (length(release_reason) <= 500),
  unique (company_id, ref)
);
create index if not exists expense_exports_company_idx on expense_exports(company_id, created_at desc);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_expenses_export_batch_fk') then
    alter table project_expenses add constraint project_expenses_export_batch_fk foreign key (export_batch_id) references expense_exports(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_expenses_export_verified_chk') then
    alter table project_expenses add constraint project_expenses_export_verified_chk check (export_batch_id is null or verified_at is not null) not valid;
  end if;
end $$;

alter table expense_exports enable row level security;
drop policy if exists ee_select on expense_exports;
create policy ee_select on expense_exports for select to authenticated using (company_id = current_company_id() and has_permission('finance.view'));
-- no insert / update / delete policies: batches are created and released only through the functions below

-- ───────────── Tally mapping (one row per company) ─────────────
create table if not exists expense_tally_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  tally_company text check (length(tally_company) <= 200),
  tally_version text not null default 'TallyPrime' check (tally_version in ('TallyPrime','Tally.ERP 9')),
  paid_mode text not null default 'payment' check (paid_mode in ('payment','purchase_and_payment')),
  category_ledgers jsonb not null default '{}'::jsonb,   -- expense category → expense / purchase ledger
  vat_ledger text check (length(vat_ledger) <= 200),     -- input VAT ledger
  payment_ledgers jsonb not null default '{}'::jsonb,    -- payment method → cash / card / bank ledger
  bank_ledgers jsonb not null default '{}'::jsonb,       -- paid-from account id → bank ledger
  validated_version text check (length(validated_version) <= 60),   -- set only after a test import succeeded in Tally
  validated_at timestamptz,
  validated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
alter table expense_tally_settings enable row level security;
drop policy if exists ets_select on expense_tally_settings;
drop policy if exists ets_insert on expense_tally_settings;
drop policy if exists ets_update on expense_tally_settings;
create policy ets_select on expense_tally_settings for select to authenticated using (company_id = current_company_id() and has_permission('finance.view'));
create policy ets_insert on expense_tally_settings for insert to authenticated with check (company_id = current_company_id() and has_permission('finance.view') and has_permission('data.export'));
create policy ets_update on expense_tally_settings for update to authenticated using (company_id = current_company_id() and has_permission('finance.view') and has_permission('data.export')) with check (company_id = current_company_id());

-- audit without the file itself (it can be large; the batch keeps it)
create or replace function audit_expense_export() returns trigger language plpgsql security definer set search_path = public as $$
declare rec jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end) - 'content';
begin
  insert into audit_logs(company_id, user_id, action, table_name, record_id, changes)
  values ((rec->>'company_id')::uuid, auth.uid(), tg_op, 'expense_exports', (rec->>'id')::uuid,
          case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old) - 'content', 'new', rec) else rec end);
  return null;
end $$;
revoke all on function audit_expense_export() from public, anon, authenticated;
drop trigger if exists audit_expense_exports on expense_exports;
create trigger audit_expense_exports after insert or update or delete on expense_exports for each row execute function audit_expense_export();
drop trigger if exists audit_expense_tally_settings on expense_tally_settings;
create trigger audit_expense_tally_settings after insert or update or delete on expense_tally_settings for each row execute function audit_row();

-- ───────────── an exported expense is locked ─────────────
-- What went to Tally cannot change underneath it: amounts, dates, ledgers and the supplier stay as exported until the
-- export is undone (released). Notes, project and approval fields can still change. Deleting is refused.
create or replace function expense_export_lock() returns trigger language plpgsql set search_path = public as $$
declare r text;
begin
  if tg_op = 'DELETE' then
    if old.export_batch_id is not null then
      select ref into r from expense_exports where id = old.export_batch_id;
      raise exception 'This expense was exported to Tally (%). Undo that export before deleting it.', coalesce(r, 'export') using errcode = 'P0001';
    end if;
    return old;
  end if;
  -- the export marker is set and cleared only by expense_export_create / _release (or when a batch row is removed)
  if current_user in ('authenticated', 'anon') and (tg_op = 'INSERT' and (new.export_batch_id is not null or new.exported_at is not null)
      or tg_op = 'UPDATE' and (new.export_batch_id is distinct from old.export_batch_id or new.exported_at is distinct from old.exported_at)) then
    raise exception 'Expenses are marked as exported only by a Tally export (and unmarked by undoing it).' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then return new; end if;
  new.updated_at := now();
  if new.export_batch_id is null and old.export_batch_id is not null then new.exported_at := null; return new; end if;
  if old.export_batch_id is not null and new.export_batch_id is not distinct from old.export_batch_id and
     (new.spent_on, new.amount, new.vat_amount, new.category, new.supplier_id, new.supplier_name, new.supplier_trn, new.reference,
      new.payment_method, new.payment_status, new.paid_from_bank_id, new.description, new.verified_at)
     is distinct from
     (old.spent_on, old.amount, old.vat_amount, old.category, old.supplier_id, old.supplier_name, old.supplier_trn, old.reference,
      old.payment_method, old.payment_status, old.paid_from_bank_id, old.description, old.verified_at) then
    select ref into r from expense_exports where id = old.export_batch_id;
    raise exception 'This expense was exported to Tally (%). Undo that export before changing amounts, dates, supplier or ledgers.', coalesce(r, 'export') using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists project_expenses_export_lock on project_expenses;
create trigger project_expenses_export_lock before insert or update or delete on project_expenses for each row execute function expense_export_lock();

-- ───────────── create / release a batch (atomic, one at a time per company) ─────────────
create or replace function expense_export_create(p_ids uuid[], p_tally_version text, p_filters jsonb, p_content text, p_checksum text, p_total numeric, p_vat numeric)
returns table (batch_id uuid, batch_ref text) language plpgsql security definer set search_path = public as $$
declare cid uuid := current_company_id(); n int; want int; tot numeric; vt numeric; bad int; yr text; seq int; r text; bid uuid;
begin
  if cid is null or not has_permission('finance.view') or not has_permission('data.export') then
    raise exception 'You are not allowed to export expenses.' using errcode = '42501';
  end if;
  select count(distinct x) into want from unnest(p_ids) x;
  if coalesce(want, 0) = 0 then raise exception 'Choose at least one expense to export.' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('expense_export:' || cid::text, 0));
  perform 1 from project_expenses where id = any(p_ids) and company_id = cid for update;
  select count(*), coalesce(sum(amount + vat_amount), 0), coalesce(sum(vat_amount), 0),
         count(*) filter (where export_batch_id is not null or verified_at is null or coalesce(approval_status, 'approved') <> 'approved')
    into n, tot, vt, bad from project_expenses where id = any(p_ids) and company_id = cid;
  if n <> want then raise exception 'Some of these expenses no longer exist. Refresh and try again.' using errcode = 'P0001'; end if;
  if bad > 0 then raise exception 'Some of these expenses were exported a moment ago, or are not verified or approved. Refresh and try again.' using errcode = 'P0001'; end if;
  if round(tot, 2) <> round(p_total, 2) or round(vt, 2) <> round(p_vat, 2) then
    raise exception 'The expenses changed while the file was being prepared. Refresh and try again.' using errcode = 'P0001';
  end if;
  yr := to_char((now() at time zone coalesce((select timezone from companies where id = cid), 'Asia/Dubai'))::date, 'YYYY');
  select coalesce(max(substring(ref from '([0-9]+)$')::int), 0) + 1 into seq from expense_exports where company_id = cid and ref like 'EXP-' || yr || '-%';
  r := 'EXP-' || yr || '-' || lpad(seq::text, 4, '0');
  insert into expense_exports(company_id, ref, tally_version, filters, expense_count, total, vat_total, file_name, content, checksum, created_by)
    values (cid, r, p_tally_version, coalesce(p_filters, '{}'::jsonb), n, tot, vt, 'averiqo-tally-' || r || '.xml', p_content, p_checksum, auth.uid())
    returning id into bid;
  update project_expenses set export_batch_id = bid, exported_at = now() where id = any(p_ids) and company_id = cid;
  return query select bid, r;
end $$;

create or replace function expense_export_release(p_id uuid, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare cid uuid := current_company_id(); n int;
begin
  if cid is null or not has_permission('finance.view') or not has_permission('data.export') or not has_permission('records.edit') then
    raise exception 'You are not allowed to undo exports.' using errcode = '42501';
  end if;
  if length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Say why the export is being undone.' using errcode = 'P0001'; end if;
  update expense_exports set released_at = now(), released_by = auth.uid(), release_reason = left(trim(p_reason), 500)
    where id = p_id and company_id = cid and released_at is null;
  if not found then raise exception 'This export was not found or was already undone.' using errcode = 'P0001'; end if;
  update project_expenses set export_batch_id = null where export_batch_id = p_id and company_id = cid;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function expense_export_create(uuid[], text, jsonb, text, text, numeric, numeric), expense_export_release(uuid, text), expense_export_lock() from public, anon;
grant execute on function expense_export_create(uuid[], text, jsonb, text, text, numeric, numeric), expense_export_release(uuid, text) to authenticated, service_role;
