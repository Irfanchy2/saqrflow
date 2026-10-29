-- 0034: Employee salary accounts: what the company owes each employee, kept as a ledger.
--
-- Safe for live data. Nothing is deleted or rewritten:
--  • salary_payments keeps every row. One rule is removed, unique (employee_id, period), which allowed only ONE payment per
--    employee per month: the cause of the "already recorded" warning. A payment is now a separate transaction; repeated
--    submissions of the same form are stopped by an idempotency key instead. New columns are nullable or defaulted.
--  • New salary_ledger holds what is owed: an opening balance (once per employee), each monthly salary accrual (once per
--    employee and month), payable adjustments, deductions and advance offsets. Posted entries are never edited: a mistake is
--    reversed with a reason and entered again.
--  • salary_allocations records which payment settled which obligation: the oldest unpaid first, or the period an admin
--    picked. It is rebuilt by the database whenever the employee's ledger or payments change, so it always reconciles.
--  • Outstanding = opening + accruals + additions − deductions − advance offsets − payments (posted rows only), computed by
--    the salary_accounts view. There is no stored balance to drift.
--  • No opening balance or accrual is created for anyone here: historical balances are unknown, so admins set them in the app
--    (with a helper that reconciles against payments already recorded).

-- ───────────── salary_payments: many payments per month ─────────────
do $$ declare k text; begin
  for k in select con.conname from pg_constraint con
           where con.conrelid = 'public.salary_payments'::regclass and con.contype = 'u'
             and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                  where a.attrelid = con.conrelid and a.attnum = any(con.conkey)) = array['employee_id','period']
  loop execute format('alter table salary_payments drop constraint %I', k); end loop;
end $$;
create index if not exists salary_payments_emp_idx on salary_payments(employee_id, paid_on);

alter table salary_payments
  add column if not exists reference text,
  add column if not exists idempotency_key uuid,
  add column if not exists status text not null default 'posted',
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references profiles(id) on delete set null,
  add column if not exists reversal_reason text,
  add column if not exists created_by uuid references profiles(id) on delete set null default auth.uid();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'salary_payments_status_check') then
    alter table salary_payments add constraint salary_payments_status_check check (status in ('posted','reversed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salary_payments_reference_len') then
    alter table salary_payments add constraint salary_payments_reference_len check (reference is null or length(reference) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salary_payments_amount_positive') then
    alter table salary_payments add constraint salary_payments_amount_positive check (amount > 0) not valid;   -- new rows only
  end if;
end $$;
-- payment methods: + "other" (the existing WPS, bank transfer, cash and cheque stay)
alter table salary_payments drop constraint if exists salary_payments_method_check;
alter table salary_payments add constraint salary_payments_method_check check (method in ('wps','bank_transfer','cash','cheque','other'));
create unique index if not exists salary_payments_idem_uidx on salary_payments(company_id, idempotency_key) where idempotency_key is not null;

-- ───────────── the ledger ─────────────
create table if not exists salary_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null check (kind in ('opening','accrual','adjustment','deduction','advance_offset')),
  period date check (period is null or period = date_trunc('month', period)::date),   -- salary month (first day)
  entry_date date not null default current_date,
  amount numeric(12,2) not null,
  advance_id uuid references employee_advances(id),
  allocate_to uuid references salary_ledger(id),
  reason text check (reason is null or length(reason) <= 500),
  status text not null default 'posted' check (status in ('posted','reversed')),
  reversed_at timestamptz,
  reversed_by uuid references profiles(id) on delete set null,
  reversal_reason text check (reversal_reason is null or length(reversal_reason) <= 500),
  idempotency_key uuid,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  -- adjustments are signed (+ owed more, − owed less); everything else is a positive amount
  check (case kind when 'adjustment' then amount <> 0 else amount > 0 end),
  check (kind <> 'accrual' or period is not null),
  check (kind <> 'advance_offset' or advance_id is not null),
  check (kind not in ('adjustment','deduction') or length(trim(coalesce(reason, ''))) > 0)
);
create index if not exists salary_ledger_emp_idx on salary_ledger(employee_id, status, kind);
create index if not exists salary_ledger_company_idx on salary_ledger(company_id, kind, period);
create unique index if not exists salary_ledger_one_opening on salary_ledger(employee_id) where kind = 'opening' and status = 'posted';
create unique index if not exists salary_ledger_one_accrual on salary_ledger(employee_id, period) where kind = 'accrual' and status = 'posted';
create unique index if not exists salary_ledger_idem_uidx on salary_ledger(company_id, idempotency_key) where idempotency_key is not null;

alter table salary_payments add column if not exists allocate_to uuid references salary_ledger(id);

-- ───────────── allocations (derived, rebuilt by the database) ─────────────
create table if not exists salary_allocations (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  obligation_id uuid not null references salary_ledger(id) on delete cascade,
  payment_id uuid references salary_payments(id) on delete cascade,
  settlement_id uuid references salary_ledger(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  check (num_nonnulls(payment_id, settlement_id) = 1)
);
create index if not exists salary_allocations_emp_idx on salary_allocations(employee_id);
create index if not exists salary_allocations_pay_idx on salary_allocations(payment_id) where payment_id is not null;
create index if not exists salary_allocations_ob_idx on salary_allocations(obligation_id);

-- ───────────── salary history (who changed what, with values; salary access only) ─────────────
create table if not exists salary_audit (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  payment_id uuid references salary_payments(id) on delete cascade,
  entry_id uuid references salary_ledger(id) on delete cascade,
  action text not null check (action in ('posted','edited','reversed')),
  reason text,
  before jsonb,
  after jsonb,
  user_id uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists salary_audit_emp_idx on salary_audit(employee_id, created_at desc);

-- ───────────── oldest-first allocation ─────────────
-- Obligations, oldest first: the opening balance, then each salary month (and additions in their month).
-- Settlements (payments, deductions, advance offsets, negative adjustments) in date order. One aimed at a period settles that
-- period first; whatever is left of any settlement goes to the oldest obligation still open. Anything beyond everything owed
-- stays unallocated: a credit that the next accrual absorbs.
create or replace function salary_reallocate(emp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ob_ids uuid[]; ob_rem numeric[]; st record; rem numeric; take numeric; i int; n int; cid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('salary:' || emp::text));
  select company_id into cid from employees where id = emp;
  if cid is null then return; end if;
  delete from salary_allocations where employee_id = emp;
  select array_agg(id order by okey, kord, created_at, id), array_agg(amount order by okey, kord, created_at, id) into ob_ids, ob_rem
  from (select id, amount, created_at,
               case when kind = 'opening' then date '0001-01-01' else coalesce(period, date_trunc('month', entry_date)::date) end okey,
               case kind when 'opening' then 0 when 'accrual' then 1 else 2 end kord
        from salary_ledger
        where employee_id = emp and status = 'posted' and (kind in ('opening','accrual') or (kind = 'adjustment' and amount > 0))) o;
  if ob_ids is null then return; end if;
  n := array_length(ob_ids, 1);
  for st in
    select * from (
      select 'p'::text src, p.id, p.amount amt, p.allocate_to tgt, coalesce(p.paid_on, p.period) d, p.created_at
        from salary_payments p where p.employee_id = emp and p.status = 'posted' and p.amount > 0
      union all
      select 'l', l.id, abs(l.amount), l.allocate_to, l.entry_date, l.created_at
        from salary_ledger l where l.employee_id = emp and l.status = 'posted'
         and (l.kind in ('deduction','advance_offset') or (l.kind = 'adjustment' and l.amount < 0))) s
    order by (s.tgt is null), s.d, s.created_at, s.id
  loop
    rem := st.amt;
    if st.tgt is not null then
      i := array_position(ob_ids, st.tgt);
      if i is not null and ob_rem[i] > 0 then
        take := least(rem, ob_rem[i]);
        insert into salary_allocations(company_id, employee_id, obligation_id, payment_id, settlement_id, amount)
        values (cid, emp, ob_ids[i], case when st.src = 'p' then st.id end, case when st.src = 'l' then st.id end, take);
        ob_rem[i] := ob_rem[i] - take; rem := rem - take;
      end if;
    end if;
    i := 1;
    while rem > 0 and i <= n loop
      if ob_rem[i] > 0 then
        take := least(rem, ob_rem[i]);
        insert into salary_allocations(company_id, employee_id, obligation_id, payment_id, settlement_id, amount)
        values (cid, emp, ob_ids[i], case when st.src = 'p' then st.id end, case when st.src = 'l' then st.id end, take);
        ob_rem[i] := ob_rem[i] - take; rem := rem - take;
      end if;
      i := i + 1;
    end loop;
  end loop;
end $$;
revoke all on function salary_reallocate(uuid) from public, anon, authenticated;

-- ───────────── integrity: what may be written, and what may change afterwards ─────────────
create or replace function salary_ledger_check() returns trigger language plpgsql security definer set search_path = public as $$
declare adv record; left_ numeric; ob record;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'reversed' then raise exception 'This salary entry is already reversed.'; end if;
    if (new.company_id, new.employee_id, new.kind, new.period, new.entry_date, new.amount, new.advance_id, new.allocate_to, new.reason, new.idempotency_key, new.created_by, new.created_at)
       is distinct from (old.company_id, old.employee_id, old.kind, old.period, old.entry_date, old.amount, old.advance_id, old.allocate_to, old.reason, old.idempotency_key, old.created_by, old.created_at) then
      raise exception 'Posted salary entries cannot be changed. Reverse the entry and enter it again.';
    end if;
    if new.status = 'reversed' then
      if length(trim(coalesce(new.reversal_reason, ''))) = 0 then raise exception 'Give a reason for the reversal.'; end if;
      new.reversed_at := now(); new.reversed_by := auth.uid();
    end if;
    return new;
  end if;
  -- INSERT
  if new.status <> 'posted' then raise exception 'New salary entries are posted.'; end if;
  if not exists (select 1 from employees e where e.id = new.employee_id and e.company_id = new.company_id) then
    raise exception 'Employee not found.';
  end if;
  new.reversed_at := null; new.reversed_by := null; new.reversal_reason := null;
  if new.kind = 'opening' then new.period := null; end if;
  if new.kind = 'accrual' and exists (select 1 from salary_ledger l where l.employee_id = new.employee_id and l.kind = 'opening'
       and l.status = 'posted' and new.period < date_trunc('month', l.entry_date)::date) then
    raise exception 'The opening balance already covers %. Post salary only for months from the opening balance date on.', to_char(new.period, 'FMMonth YYYY');
  end if;
  if new.allocate_to is not null then
    select * into ob from salary_ledger l where l.id = new.allocate_to;
    if ob.id is null or ob.employee_id <> new.employee_id or ob.status <> 'posted'
       or not (ob.kind in ('opening','accrual') or (ob.kind = 'adjustment' and ob.amount > 0)) then
      raise exception 'Choose one of this employee''s unpaid salary periods.';
    end if;
  end if;
  if new.kind = 'advance_offset' then
    select * into adv from employee_advances a where a.id = new.advance_id;
    if adv.id is null or adv.employee_id <> new.employee_id or adv.kind <> 'advance' then raise exception 'Choose one of this employee''s advances.'; end if;
    left_ := adv.amount - coalesce((select sum(l.amount) from salary_ledger l where l.advance_id = adv.id and l.kind = 'advance_offset' and l.status = 'posted'), 0);
    if new.amount > left_ then raise exception 'Only % of this advance is still to be recovered.', to_char(left_, 'FM999,999,990.00'); end if;
  end if;
  return new;
end $$;
revoke execute on function salary_ledger_check() from public, anon, authenticated;
drop trigger if exists salary_ledger_check_t on salary_ledger;
create trigger salary_ledger_check_t before insert or update on salary_ledger for each row execute function salary_ledger_check();

create or replace function salary_payments_check() returns trigger language plpgsql security definer set search_path = public as $$
declare ob record;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'reversed' and (new.status, new.amount, new.paid_on, new.method, new.reference, new.notes) is distinct from (old.status, old.amount, old.paid_on, old.method, old.reference, old.notes) then
      raise exception 'This payment is reversed and can no longer be changed.';
    end if;
    if (new.company_id, new.employee_id, new.amount, new.period, new.allocate_to, new.idempotency_key, new.created_at)
       is distinct from (old.company_id, old.employee_id, old.amount, old.period, old.allocate_to, old.idempotency_key, old.created_at) then
      raise exception 'A recorded payment''s amount and employee cannot be changed. Reverse it and record it again.';
    end if;
    if new.status = 'reversed' and old.status = 'posted' then
      if length(trim(coalesce(new.reversal_reason, ''))) = 0 then raise exception 'Give a reason for the reversal.'; end if;
      new.reversed_at := now(); new.reversed_by := auth.uid();
    elsif new.status is distinct from old.status then raise exception 'A reversed payment stays reversed.';
    end if;
    return new;
  end if;
  if not exists (select 1 from employees e where e.id = new.employee_id and e.company_id = new.company_id) then
    raise exception 'Employee not found.';
  end if;
  new.status := 'posted'; new.reversed_at := null; new.reversed_by := null; new.reversal_reason := null;
  if new.allocate_to is not null then
    select * into ob from salary_ledger l where l.id = new.allocate_to;
    if ob.id is null or ob.employee_id <> new.employee_id or ob.status <> 'posted'
       or not (ob.kind in ('opening','accrual') or (ob.kind = 'adjustment' and ob.amount > 0)) then
      raise exception 'Choose one of this employee''s unpaid salary periods.';
    end if;
  end if;
  return new;
end $$;
revoke execute on function salary_payments_check() from public, anon, authenticated;
drop trigger if exists salary_payments_check_t on salary_payments;
create trigger salary_payments_check_t before insert or update on salary_payments for each row execute function salary_payments_check();

-- after any change: rebuild allocations, keep advances' "settled" in step with their recoveries, write the salary history
create or replace function salary_after_change() returns trigger language plpgsql security definer set search_path = public as $$
declare act text; adv uuid;
begin
  perform salary_reallocate(new.employee_id);
  if tg_table_name = 'salary_ledger' then
    adv := (to_jsonb(new) ->> 'advance_id')::uuid;            -- set only on advance offsets
    if adv is not null then
      update employee_advances a set settled = (a.amount - coalesce((select sum(l.amount) from salary_ledger l
             where l.advance_id = a.id and l.kind = 'advance_offset' and l.status = 'posted'), 0)) <= 0
      where a.id = adv;
    end if;
  end if;
  act := case when tg_op = 'INSERT' then 'posted' when new.status = 'reversed' and old.status = 'posted' then 'reversed' else 'edited' end;
  insert into salary_audit(company_id, employee_id, payment_id, entry_id, action, reason, before, after)
  values (new.company_id, new.employee_id,
          case when tg_table_name = 'salary_payments' then new.id end, case when tg_table_name = 'salary_ledger' then new.id end,
          act, case when act = 'reversed' then new.reversal_reason end,
          case when tg_op = 'UPDATE' then to_jsonb(old) - 'idempotency_key' end, to_jsonb(new) - 'idempotency_key');
  return null;
end $$;
revoke execute on function salary_after_change() from public, anon, authenticated;
drop trigger if exists salary_ledger_after_t on salary_ledger;
create trigger salary_ledger_after_t after insert or update on salary_ledger for each row execute function salary_after_change();
drop trigger if exists salary_payments_after_t on salary_payments;
create trigger salary_payments_after_t after insert or update on salary_payments for each row execute function salary_after_change();

-- ───────────── views (RLS of the caller applies) ─────────────
create or replace view salary_obligations with (security_invoker = true) as
select l.id, l.company_id, l.employee_id, l.kind, l.period, l.entry_date, l.amount, l.reason, l.created_at,
       coalesce(a.allocated, 0)::numeric(12,2) allocated, (l.amount - coalesce(a.allocated, 0))::numeric(12,2) remaining,
       case when coalesce(a.allocated, 0) >= l.amount then 'paid' when coalesce(a.allocated, 0) > 0 then 'partial' else 'unpaid' end status
from salary_ledger l
left join (select obligation_id, sum(amount) allocated from salary_allocations group by obligation_id) a on a.obligation_id = l.id
where l.status = 'posted' and (l.kind in ('opening','accrual') or (l.kind = 'adjustment' and l.amount > 0));

create or replace view salary_accounts with (security_invoker = true) as
select e.id employee_id, e.company_id,
       coalesce(l.opening, 0)::numeric(12,2) opening, coalesce(l.accrued, 0)::numeric(12,2) accrued,
       coalesce(l.additions, 0)::numeric(12,2) additions, coalesce(l.deductions, 0)::numeric(12,2) deductions,
       coalesce(l.offsets, 0)::numeric(12,2) offsets, coalesce(p.paid, 0)::numeric(12,2) paid,
       (coalesce(l.opening, 0) + coalesce(l.accrued, 0) + coalesce(l.additions, 0) - coalesce(l.deductions, 0)
        - coalesce(l.offsets, 0) - coalesce(p.paid, 0))::numeric(12,2) outstanding,
       l.last_accrual, l.opening_date
from employees e
left join (select employee_id,
             sum(amount) filter (where kind = 'opening') opening,
             max(entry_date) filter (where kind = 'opening') opening_date,
             sum(amount) filter (where kind = 'accrual') accrued,
             sum(amount) filter (where kind = 'adjustment' and amount > 0) additions,
             sum(abs(amount)) filter (where kind = 'deduction' or (kind = 'adjustment' and amount < 0)) deductions,
             sum(amount) filter (where kind = 'advance_offset') offsets,
             max(period) filter (where kind = 'accrual') last_accrual
           from salary_ledger where status = 'posted' group by employee_id) l on l.employee_id = e.id
left join (select employee_id, sum(amount) paid from salary_payments where status = 'posted' group by employee_id) p on p.employee_id = e.id;

create or replace view employee_advance_balances with (security_invoker = true) as
select a.id, a.company_id, a.employee_id, a.kind, a.amount, a.given_on, a.monthly_recovery, a.settled, a.notes,
       coalesce(r.recovered, 0)::numeric(12,2) recovered,
       case when a.kind = 'advance' then greatest(a.amount - coalesce(r.recovered, 0), 0) else 0 end::numeric(12,2) remaining
from employee_advances a
left join (select advance_id, sum(amount) recovered from salary_ledger where kind = 'advance_offset' and status = 'posted' group by advance_id) r on r.advance_id = a.id;

-- ───────────── actions as one transaction each ─────────────
-- Post one salary month for the chosen employees at each one's current monthly salary (the amount is kept on the entry, so a
-- later salary change never alters it). A month already posted for someone is skipped: running it twice posts nothing twice.
create or replace function salary_post_month(p_period date, p_employees uuid[]) returns integer
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if not has_permission('salary.view') then raise exception 'You do not have permission to post salary.'; end if;
  if p_period is null or p_period <> date_trunc('month', p_period)::date then raise exception 'Choose a salary month.'; end if;
  insert into salary_ledger(company_id, employee_id, kind, period, entry_date, amount)
  -- dated the last day of the month, or the day it is posted when that is earlier (so a statement up to today includes it)
  select e.company_id, e.id, 'accrual', p_period, least((p_period + interval '1 month - 1 day')::date, current_date), c.monthly_salary
  from employees e join employee_compensation c on c.employee_id = e.id
  where e.id = any(p_employees) and e.company_id = current_company_id() and e.deleted_at is null and c.monthly_salary > 0
    and not exists (select 1 from salary_ledger l where l.employee_id = e.id and l.kind = 'accrual' and l.period = p_period and l.status = 'posted')
  on conflict (employee_id, period) where kind = 'accrual' and status = 'posted' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function salary_post_month(date, uuid[]) from public, anon;
grant execute on function salary_post_month(date, uuid[]) to authenticated;

-- Set (or correct) an employee's opening balance: what was owed before the system's records start. A correction reverses the
-- previous opening entry with the reason given, then posts the new amount (0 = no opening balance).
create or replace function salary_set_opening(p_employee uuid, p_amount numeric, p_as_of date, p_reason text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare old_id uuid; new_id uuid; first_acc date;
begin
  if not has_permission('salary.view') then raise exception 'You do not have permission to change salary balances.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter the amount owed (0 or more).'; end if;
  if p_as_of is null then raise exception 'Choose the date the opening balance is for.'; end if;
  perform pg_advisory_xact_lock(hashtext('salary:' || p_employee::text));
  select id into old_id from salary_ledger where employee_id = p_employee and kind = 'opening' and status = 'posted';
  if old_id is not null then
    if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Give a reason for changing the opening balance.'; end if;
    update salary_ledger set status = 'reversed', reversal_reason = p_reason where id = old_id;
  end if;
  select min(period) into first_acc from salary_ledger where employee_id = p_employee and kind = 'accrual' and status = 'posted';
  if p_amount > 0 and first_acc is not null and first_acc < date_trunc('month', p_as_of)::date then
    raise exception 'Salary for % is already posted. The opening balance must be dated on or before that month so nothing is counted twice.', to_char(first_acc, 'FMMonth YYYY');
  end if;
  if p_amount > 0 then
    insert into salary_ledger(company_id, employee_id, kind, entry_date, amount, reason)
    select e.company_id, e.id, 'opening', p_as_of, p_amount, nullif(trim(coalesce(p_reason, '')), '')
    from employees e where e.id = p_employee and e.company_id = current_company_id()
    returning id into new_id;
    if new_id is null then raise exception 'Employee not found.'; end if;
  end if;
  return new_id;
end $$;
revoke all on function salary_set_opening(uuid, numeric, date, text) from public, anon;
grant execute on function salary_set_opening(uuid, numeric, date, text) to authenticated;

-- ───────────── row-level security ─────────────
do $$ begin
  perform apply_standard_rls('salary_ledger', 'salary.view', 'salary.view');
end $$;
-- posted money is reversed, never deleted (company / employee deletion still cascades)
drop policy if exists tenant_delete on salary_ledger;
drop policy if exists tenant_delete on salary_payments;
alter table salary_allocations enable row level security;
create policy tenant_select on salary_allocations for select to authenticated using (company_id = current_company_id() and has_permission('salary.view'));
alter table salary_audit enable row level security;
create policy tenant_select on salary_audit for select to authenticated using (company_id = current_company_id() and has_permission('salary.view'));
-- employees read their own salary account (never the history of who changed what)
do $$ declare t text; begin
  foreach t in array array['salary_ledger','salary_allocations'] loop
    execute format('drop policy if exists self_select on %I', t);
    execute format('create policy self_select on %I for select to authenticated using (company_id = current_company_id() and employee_id = my_employee_id())', t);
  end loop;
end $$;
revoke all on salary_ledger, salary_allocations, salary_audit from anon;
revoke insert, update, delete on salary_allocations, salary_audit from authenticated;

-- ───────────── audit log: salary values stay redacted ─────────────
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare rec jsonb; cid uuid; rid uuid; payload jsonb;
begin
  rec := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  cid := coalesce((rec->>'company_id')::uuid, case when tg_table_name = 'companies' then (rec->>'id')::uuid end);
  rid := nullif(rec->>'id','')::uuid;
  if tg_table_name in ('employee_compensation','salary_payments','employee_advances','salary_ledger') then
    payload := jsonb_build_object('redacted', true);          -- never copy salary values into the audit log
  elsif tg_op = 'UPDATE' then
    payload := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  else payload := rec; end if;
  insert into audit_logs(company_id, user_id, action, table_name, record_id, changes)
  values (cid, auth.uid(), tg_op, tg_table_name, rid, payload);
  return null;
end $$;
drop trigger if exists audit_salary_ledger on salary_ledger;
create trigger audit_salary_ledger after insert or update or delete on salary_ledger for each row execute function audit_row();
