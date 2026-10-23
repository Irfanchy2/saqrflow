-- 0027: stock (materials on hand, receipts, issues to jobs, reorder levels) and bank accounts with a running ledger.
-- Additive only: new tables, new nullable / defaulted columns, triggers. No existing row is changed.
--
-- Stock: stock_items holds each material; on_hand and avg_cost are kept by the movement trigger and cannot be edited
-- directly. stock_movements is the immutable ledger (corrections are new adjustment rows); an issue never takes
-- on_hand below zero. Issues record the average cost at the time, so a job's material cost can be read later.
--
-- Banking: banks also holds the banks named on customers' cheques, so a row becomes one of the company's own accounts
-- only when is_account is set (existing rows stay plain bank names). Accounts get an opening balance, a type (cash =
-- petty cash / cash on hand), a default flag and an active flag. bank_transactions is the ledger; balance = opening balance + sum(amount).
-- Rows come from four places, each synced by a trigger, one row per source (unique source_type, source_id):
--   payments.deposit_bank_id (money in), project_expenses.paid_from_bank_id (money out),
--   outgoing cheques once cleared (money out), and manual entries (deposits, withdrawals, transfers, fees).
-- Existing payments / expenses / cheques have no bank set, so current figures are untouched until someone picks one.

-- ───────────── stock ─────────────
create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  sku text check (length(sku) <= 40),
  name text not null check (length(name) between 1 and 200),
  category text check (length(category) <= 80),
  unit text not null default 'Nos' check (length(unit) between 1 and 20),
  location text check (length(location) <= 80),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  reorder_qty numeric(14,3) not null default 0 check (reorder_qty >= 0),
  on_hand numeric(14,3) not null default 0,
  avg_cost numeric(14,4) not null default 0 check (avg_cost >= 0),
  supplier_id uuid references suppliers(id) on delete set null,
  catalog_item_id uuid references catalog_items(id) on delete set null,
  notes text check (length(notes) <= 1000),
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create unique index if not exists stock_items_sku_uidx on stock_items(company_id, lower(sku)) where sku is not null and sku <> '';
create index if not exists stock_items_company_idx on stock_items(company_id, active, lower(name));
-- "running low": at or below the reorder level (stored, so lists, badges and the dashboard can filter on it)
alter table stock_items add column if not exists is_low boolean generated always as (active and reorder_level > 0 and on_hand <= reorder_level) stored;
create index if not exists stock_items_low_idx on stock_items(company_id) where is_low;

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  item_id uuid not null references stock_items(id) on delete restrict,
  kind text not null check (kind in ('opening','receipt','issue','return','adjustment')),
  qty numeric(14,3) not null check (qty <> 0),                 -- signed: receipts / returns in (+), issues out (−)
  unit_cost numeric(14,4) check (unit_cost >= 0),              -- receipts: purchase cost; issues: average cost at the time
  moved_on date not null default current_date,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text check (length(supplier_name) <= 200),
  reference text check (length(reference) <= 120),             -- supplier invoice / delivery / PO number
  project_id uuid references projects(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  notes text check (length(notes) <= 1000),
  balance_after numeric(14,3),
  idempotency_key uuid,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint stock_movements_sign check (
    (kind in ('opening','receipt','return') and qty > 0) or (kind = 'issue' and qty < 0) or kind = 'adjustment')
);
create unique index if not exists stock_movements_idem_uidx on stock_movements(company_id, idempotency_key) where idempotency_key is not null;
create index if not exists stock_movements_item_idx on stock_movements(item_id, moved_on desc, created_at desc);
create index if not exists stock_movements_company_idx on stock_movements(company_id, moved_on desc);
create index if not exists stock_movements_project_idx on stock_movements(company_id, project_id) where project_id is not null;

-- applies a movement to its item (row-locked, so concurrent issues cannot both take the last unit)
create or replace function stock_movement_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare it stock_items; nq numeric;
begin
  select * into it from stock_items where id = new.item_id for update;
  if it.id is null or it.company_id <> new.company_id then raise exception 'stock item belongs to another company'; end if;
  if new.project_id is not null and not exists (select 1 from projects where id = new.project_id and company_id = new.company_id) then raise exception 'project belongs to another company'; end if;
  if new.work_order_id is not null and not exists (select 1 from work_orders where id = new.work_order_id and company_id = new.company_id) then raise exception 'work order belongs to another company'; end if;
  nq := it.on_hand + new.qty;
  if nq < 0 then raise exception 'not enough stock: % % on hand', trim(to_char(it.on_hand, 'FM999999990.###')), it.unit using errcode = 'P0001'; end if;
  if new.qty < 0 and new.unit_cost is null then new.unit_cost := it.avg_cost; end if;
  new.balance_after := nq;
  update stock_items set on_hand = nq, updated_at = now(),
    avg_cost = case when new.qty > 0 and new.unit_cost is not null and nq > 0
                    then round(((greatest(it.on_hand, 0) * it.avg_cost) + new.qty * new.unit_cost) / (greatest(it.on_hand, 0) + new.qty), 4)
                    else it.avg_cost end
  where id = it.id;
  return new;
end $$;
drop trigger if exists stock_movement_apply_t on stock_movements;
create trigger stock_movement_apply_t before insert on stock_movements for each row execute function stock_movement_apply();

-- on_hand / avg_cost change only through movements
create or replace function stock_items_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.on_hand := 0; new.avg_cost := 0; return new; end if;
  if pg_trigger_depth() <= 1 then new.on_hand := old.on_hand; new.avg_cost := old.avg_cost; end if;
  return new;
end $$;
drop trigger if exists stock_items_guard_t on stock_items;
create trigger stock_items_guard_t before insert or update on stock_items for each row execute function stock_items_guard();

-- ───────────── banking ─────────────
alter table banks
  add column if not exists is_account boolean not null default false,
  add column if not exists account_type text not null default 'current' check (account_type in ('current','savings','cash','card','other')),
  add column if not exists opening_balance numeric(14,2) not null default 0,
  add column if not exists opening_date date,
  add column if not exists is_default boolean not null default false,
  add column if not exists active boolean not null default true,
  add column if not exists notes text check (length(notes) <= 1000);
create unique index if not exists banks_one_default_uidx on banks(company_id) where is_default;

alter table payments add column if not exists deposit_bank_id uuid references banks(id) on delete restrict;
alter table project_expenses add column if not exists paid_from_bank_id uuid references banks(id) on delete restrict;
create index if not exists payments_bank_idx on payments(deposit_bank_id) where deposit_bank_id is not null;
create index if not exists project_expenses_bank_idx on project_expenses(paid_from_bank_id) where paid_from_bank_id is not null;

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  bank_id uuid not null references banks(id) on delete restrict,
  kind text not null check (kind in ('payment_in','expense_out','cheque_out','deposit','withdrawal','transfer_in','transfer_out','fee','interest','adjustment')),
  amount numeric(14,2) not null check (amount <> 0),          -- signed: money in (+), money out (−)
  txn_date date not null default current_date,
  description text check (length(description) <= 300),
  reference text check (length(reference) <= 120),
  source_type text check (source_type in ('payment','expense','cheque')),   -- null = entered by hand
  source_id uuid,
  transfer_group uuid,
  idempotency_key uuid,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint bank_txn_source check ((source_type is null) = (source_id is null)),
  constraint bank_txn_sign check (
    (kind in ('payment_in','deposit','transfer_in','interest') and amount > 0) or
    (kind in ('expense_out','cheque_out','withdrawal','transfer_out','fee') and amount < 0) or kind = 'adjustment')
);
create unique index if not exists bank_txn_source_uidx on bank_transactions(source_type, source_id) where source_type is not null;
create unique index if not exists bank_txn_idem_uidx on bank_transactions(company_id, idempotency_key) where idempotency_key is not null;
create index if not exists bank_txn_bank_idx on bank_transactions(bank_id, txn_date desc, created_at desc);
create index if not exists bank_txn_company_idx on bank_transactions(company_id, txn_date desc);

-- one ledger row per source; a null bank or amount removes it
create or replace function bank_sync(p_company uuid, p_type text, p_id uuid, p_bank uuid, p_kind text, p_amount numeric, p_date date, p_desc text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_bank is null or coalesce(p_amount, 0) = 0 then
    delete from bank_transactions where source_type = p_type and source_id = p_id; return;
  end if;
  if not exists (select 1 from banks where id = p_bank and company_id = p_company) then raise exception 'bank account belongs to another company'; end if;
  if not exists (select 1 from banks where id = p_bank and is_account) then   -- a counterparty bank name, not one of our accounts
    delete from bank_transactions where source_type = p_type and source_id = p_id; return;
  end if;
  insert into bank_transactions(company_id, bank_id, kind, amount, txn_date, description, reference, source_type, source_id, created_by)
    values (p_company, p_bank, p_kind, round(p_amount, 2), p_date, left(p_desc, 300), left(p_ref, 120), p_type, p_id, auth.uid())
  on conflict (source_type, source_id) where source_type is not null do update
    set bank_id = excluded.bank_id, kind = excluded.kind, amount = excluded.amount, txn_date = excluded.txn_date,
        description = excluded.description, reference = excluded.reference;
end $$;
revoke execute on function bank_sync(uuid, text, uuid, uuid, text, numeric, date, text, text) from public, anon, authenticated;

-- the applied part of a split advance stays in the account the advance went into
create or replace function payments_bank_inherit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.split_from is not null and new.deposit_bank_id is null then
    select deposit_bank_id into new.deposit_bank_id from payments where id = new.split_from;
  end if;
  return new;
end $$;
drop trigger if exists payments_bank_inherit_t on payments;
create trigger payments_bank_inherit_t before insert on payments for each row execute function payments_bank_inherit();

create or replace function payments_bank_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then delete from bank_transactions where source_type = 'payment' and source_id = old.id; return null; end if;
  perform bank_sync(new.company_id, 'payment', new.id, new.deposit_bank_id, 'payment_in', new.amount, new.paid_on,
    'Payment received' || coalesce(' · ' || (select number from invoices where id = new.invoice_id), ''), new.reference);
  return null;
end $$;
drop trigger if exists payments_bank_sync_t on payments;
create trigger payments_bank_sync_t after insert or update or delete on payments for each row execute function payments_bank_sync();

create or replace function expenses_bank_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then delete from bank_transactions where source_type = 'expense' and source_id = old.id; return null; end if;
  perform bank_sync(new.company_id, 'expense', new.id, new.paid_from_bank_id, 'expense_out', -abs(new.amount), new.spent_on,
    'Expense · ' || coalesce(nullif(new.description, ''), new.category), new.supplier_name);
  return null;
end $$;
drop trigger if exists expenses_bank_sync_t on project_expenses;
create trigger expenses_bank_sync_t after insert or update or delete on project_expenses for each row execute function expenses_bank_sync();

create or replace function cheques_bank_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then delete from bank_transactions where source_type = 'cheque' and source_id = old.id; return null; end if;
  perform bank_sync(new.company_id, 'cheque', new.id,
    case when new.direction = 'outgoing' and new.status = 'cleared' then new.bank_id end, 'cheque_out', -abs(new.amount),
    coalesce(new.deposit_date, new.cheque_date), 'Cheque ' || new.cheque_no || ' to ' || new.party_name, new.cheque_no);
  return null;
end $$;
drop trigger if exists cheques_bank_sync_t on cheques;
create trigger cheques_bank_sync_t after insert or update or delete on cheques for each row execute function cheques_bank_sync();

-- balances per account (RLS of the caller applies)
create or replace view bank_balances with (security_invoker = true) as
  select b.id, b.company_id, b.name, b.account_display_name, b.is_account, b.account_type, b.is_default, b.active, b.opening_balance, b.opening_date,
         b.opening_balance + coalesce(t.total, 0) as balance, coalesce(t.n, 0) as txn_count, t.last_txn
  from banks b
  left join (select bank_id, sum(amount) as total, count(*) as n, max(txn_date) as last_txn from bank_transactions group by bank_id) t on t.bank_id = b.id
  where b.is_account;

-- ───────────── security ─────────────
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_items') then perform apply_standard_rls('stock_items', 'documents.view', 'records.edit'); end if;
end $$;

alter table stock_movements enable row level security;
drop policy if exists sm_select on stock_movements;
create policy sm_select on stock_movements for select to authenticated using (company_id = current_company_id() and has_permission('documents.view'));
drop policy if exists sm_insert on stock_movements;
create policy sm_insert on stock_movements for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit') and created_by = auth.uid());
-- the movement history is immutable: no update / delete policy

alter table bank_transactions enable row level security;
drop policy if exists bt_select on bank_transactions;
create policy bt_select on bank_transactions for select to authenticated using (company_id = current_company_id() and has_permission('finance.view'));
drop policy if exists bt_insert on bank_transactions;
create policy bt_insert on bank_transactions for insert to authenticated
  with check (company_id = current_company_id() and has_permission('cheques.manage') and source_type is null and created_by = auth.uid());
drop policy if exists bt_delete on bank_transactions;
create policy bt_delete on bank_transactions for delete to authenticated
  using (company_id = current_company_id() and has_permission('cheques.manage') and has_permission('records.delete') and source_type is null);
-- no update policy: a wrong entry is deleted (manual) or fixed at its source (payment, expense, cheque)

revoke execute on function stock_movement_apply(), stock_items_guard(), payments_bank_inherit(), payments_bank_sync(), expenses_bank_sync(), cheques_bank_sync() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['stock_items','stock_movements','bank_transactions'] loop
    execute format('drop trigger if exists audit_%1$s on %1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row()', t);
  end loop;
end $$;
