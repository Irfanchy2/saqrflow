-- 0037: Employee Petty Cash, business expense wallet & settlement. Additive and safe to re-run: no existing data is changed.
--
-- Petty cash is company money an employee holds for company purchases. It is NOT salary, NOT a salary advance, and is
-- never read by or written to any salary / payroll table (salary_ledger, salary_payments, employee_advances, payslips).
--
-- One ledger, two books, every row posted once and never edited or deleted (corrections are reversal rows):
--   wallet         received (+) · expense_settled (−) · returned (−) · adjustment (±)      → available petty cash
--   reimbursement  reimbursement_payable (+) · reimbursement_paid (−)                       → what the company owes the employee
-- Employee-reported money received and returns wait in petty_cash_requests until an approver confirms them.
-- Company cash (bank_transactions) moves only when real money moves: petty cash handed over (−), a return received (+),
-- a reimbursement paid (−). Settling an expense from petty cash recognises the expense without moving company cash again.

-- ───────────── 1. whose money paid for an employee expense claim ─────────────
-- petty_cash = the company petty cash the employee holds · personal = the employee's own money (reimbursed) ·
-- company = paid directly by the company (company card / account). Earlier claims stay NULL: not classified after the fact.
alter table expense_claims add column if not exists funded_by text check (funded_by in ('petty_cash','personal','company'));
-- a company card is company money: such a claim is never settled from petty cash or reimbursed (earlier rows: funded_by NULL, unaffected)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'expense_claims_card_funded_chk') then
    alter table expense_claims add constraint expense_claims_card_funded_chk check (card_id is null or funded_by is null or funded_by = 'company');
  end if;
end $$;

-- ───────────── 2. requests from employees (money received, returns) ─────────────
create table if not exists petty_cash_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,
  kind text not null check (kind in ('received','return')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','correction_requested','withdrawn')),
  amount numeric(14,2) not null check (amount > 0 and amount <= 10000000),
  entry_date date not null,
  method text not null default 'cash' check (method in ('cash','bank_transfer','cheque','card','other')),
  counterparty text check (length(counterparty) <= 200),            -- received from / handed to
  project_id uuid references projects(id) on delete set null,
  purpose text check (length(purpose) <= 300),
  reference text check (length(reference) <= 120),
  notes text check (length(notes) <= 2000),
  document_id uuid references documents(id) on delete set null,
  decision_note text check (length(decision_note) <= 2000),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  entry_id uuid,                                                    -- the ledger row it became (or was matched to)
  linked boolean not null default false,                            -- matched to petty cash the company had already recorded
  submitted_by uuid references profiles(id) on delete set null default auth.uid(),
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pcr_idem_uidx on petty_cash_requests(company_id, idempotency_key) where idempotency_key is not null;
create index if not exists pcr_queue_idx on petty_cash_requests(company_id, status, created_at desc);
create index if not exists pcr_employee_idx on petty_cash_requests(employee_id, created_at desc);

-- ───────────── 3. the ledger ─────────────
create table if not exists petty_cash_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,
  book text not null check (book in ('wallet','reimbursement')),
  kind text not null check (kind in ('received','expense_settled','returned','adjustment','reimbursement_payable','reimbursement_paid','reversal')),
  reverses_kind text check (reverses_kind in ('received','expense_settled','returned','adjustment','reimbursement_payable','reimbursement_paid')),
  amount numeric(14,2) not null check (amount <> 0),               -- signed, in the book's direction
  currency text not null default 'AED' check (currency = 'AED'),
  entry_date date not null,
  description text not null check (length(description) between 1 and 300),
  reference text check (length(reference) <= 120),
  method text check (method in ('cash','bank_transfer','cheque','card','other')),
  bank_id uuid references banks(id) on delete restrict,             -- the company account the money left or arrived in
  project_id uuid references projects(id) on delete set null,
  claim_id uuid references expense_claims(id) on delete restrict,
  request_id uuid references petty_cash_requests(id) on delete restrict,
  document_id uuid references documents(id) on delete set null,
  reverses_id uuid references petty_cash_entries(id) on delete restrict,
  source_event text not null check (length(source_event) <= 200), -- one posting per business event (retries, double clicks)
  notes text check (length(notes) <= 2000),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  approved_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pce_book check (
    (kind in ('received','expense_settled','returned','adjustment') and book = 'wallet') or
    (kind in ('reimbursement_payable','reimbursement_paid') and book = 'reimbursement') or
    (kind = 'reversal' and reverses_id is not null and reverses_kind is not null)),
  constraint pce_sign check (
    (kind in ('received','reimbursement_payable') and amount > 0) or
    (kind in ('expense_settled','returned','reimbursement_paid') and amount < 0) or kind in ('adjustment','reversal')),
  constraint pce_bank check (bank_id is null or coalesce(reverses_kind, kind) in ('received','returned','reimbursement_paid'))
);
create or replace function petty_cash_entries_immutable() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from companies where id = old.company_id) then return old; end if;
  raise exception 'Posted petty cash entries cannot be changed or deleted: post a reversal or an adjustment instead.';
end $$;
revoke execute on function petty_cash_entries_immutable() from public, anon, authenticated;
drop trigger if exists petty_cash_entries_immutable_t on petty_cash_entries;
create trigger petty_cash_entries_immutable_t before update or delete on petty_cash_entries for each row execute function petty_cash_entries_immutable();
create unique index if not exists pce_event_uidx on petty_cash_entries(company_id, source_event);
create unique index if not exists pce_reverses_uidx on petty_cash_entries(reverses_id) where reverses_id is not null;
create index if not exists pce_employee_idx on petty_cash_entries(employee_id, entry_date, created_at);
create index if not exists pce_company_idx on petty_cash_entries(company_id, entry_date desc);
create index if not exists pce_claim_idx on petty_cash_entries(claim_id) where claim_id is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pcr_entry_fk') then
    alter table petty_cash_requests add constraint pcr_entry_fk foreign key (entry_id) references petty_cash_entries(id) on delete restrict;
  end if;
end $$;
-- one employee report per recorded hand-over: the same money is never credited twice
create unique index if not exists pcr_linked_uidx on petty_cash_requests(entry_id) where entry_id is not null and status = 'approved';

-- ───────────── 4. cash flow: company accounts move only for real money ─────────────
alter table bank_transactions drop constraint if exists bank_transactions_source_type_check;
alter table bank_transactions add constraint bank_transactions_source_type_check check (source_type in ('payment','expense','cheque','petty_cash'));

create or replace function petty_cash_bank_sync() returns trigger language plpgsql security definer set search_path = public as $$
declare cash numeric; k text := coalesce(new.reverses_kind, new.kind);
begin
  if new.bank_id is null then return null; end if;
  -- company cash: handing petty cash over and paying a reimbursement take money out; a return brings it back
  cash := case when k in ('received','reimbursement_paid') then -abs(new.amount) when k = 'returned' then abs(new.amount) else 0 end;
  if new.kind = 'reversal' then cash := -cash; end if;
  perform bank_sync(new.company_id, 'petty_cash', new.id, new.bank_id, case when cash < 0 then 'withdrawal' else 'deposit' end, cash, new.entry_date,
    'Petty cash · ' || coalesce((select full_name from employees where id = new.employee_id), 'employee') || ' · ' || new.description, new.reference);
  return null;
end $$;
revoke execute on function petty_cash_bank_sync() from public, anon, authenticated;
drop trigger if exists petty_cash_bank_sync_t on petty_cash_entries;
create trigger petty_cash_bank_sync_t after insert on petty_cash_entries for each row execute function petty_cash_bank_sync();

-- ───────────── 5. who may manage petty cash ─────────────
create or replace function petty_can_manage() returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('expenses.approve') or has_permission('approvals.decide')
$$;
revoke all on function petty_can_manage() from public, anon;
grant execute on function petty_can_manage() to authenticated;

-- ───────────── 6. security ─────────────
alter table petty_cash_entries enable row level security;
drop policy if exists pce_select on petty_cash_entries;
create policy pce_select on petty_cash_entries for select to authenticated using (
  company_id = current_company_id() and (employee_id = my_employee_id() or petty_can_manage() or has_permission('finance.view')));
-- no insert / update / delete policies: rows are written only by the functions below, and never changed
revoke insert, update, delete, truncate on petty_cash_entries from authenticated, anon;

alter table petty_cash_requests enable row level security;
drop policy if exists pcr_select on petty_cash_requests;
create policy pcr_select on petty_cash_requests for select to authenticated using (
  company_id = current_company_id() and (employee_id = my_employee_id() or petty_can_manage() or has_permission('finance.view')));
drop policy if exists pcr_insert on petty_cash_requests;
create policy pcr_insert on petty_cash_requests for insert to authenticated with check (
  company_id = current_company_id() and employee_id = my_employee_id() and status = 'pending'
  and entry_id is null and not linked and decided_by is null and decided_at is null and decision_note is null
  and (submitted_by is null or submitted_by = auth.uid())
  and (project_id is null or exists (select 1 from projects p where p.id = project_id and p.company_id = current_company_id()))
  and (document_id is null or exists (select 1 from documents d where d.id = document_id and d.company_id = current_company_id())));
drop policy if exists pcr_update on petty_cash_requests;
create policy pcr_update on petty_cash_requests for update to authenticated
  using (company_id = current_company_id() and employee_id = my_employee_id() and status in ('pending','correction_requested'))
  with check (company_id = current_company_id() and employee_id = my_employee_id() and status in ('pending','withdrawn')
    and (project_id is null or exists (select 1 from projects p where p.id = project_id and p.company_id = current_company_id()))
    and (document_id is null or exists (select 1 from documents d where d.id = document_id and d.company_id = current_company_id())));
revoke delete, truncate on petty_cash_requests from authenticated, anon;

-- the employee may change their own pending report (a corrected one goes back to pending) or withdraw it; decisions,
-- the ledger link and ownership change only through petty_decide_request()
create or replace function petty_cash_requests_guard() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if current_setting('app.petty_decision', true) = 'on' then return new; end if;
  if new.company_id <> old.company_id or new.employee_id <> old.employee_id or new.kind <> old.kind
     or new.entry_id is distinct from old.entry_id or new.linked <> old.linked or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at or new.decision_note is distinct from old.decision_note
     or new.status in ('approved','rejected','correction_requested') then
    raise exception 'Only an approver can decide this.';
  end if;
  return new;
end $$;
drop trigger if exists petty_cash_requests_guard_t on petty_cash_requests;
create trigger petty_cash_requests_guard_t before update on petty_cash_requests for each row execute function petty_cash_requests_guard();
revoke execute on function petty_cash_requests_guard() from public, anon, authenticated;

-- approvers hear about new and corrected reports; the employee hears the decision
create or replace function petty_cash_requests_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare emp_user uuid; emp_name text; what text; amt text;
begin
  select e.user_id, e.full_name into emp_user, emp_name from employees e where e.id = new.employee_id;
  what := case new.kind when 'received' then 'Petty cash received' else 'Petty cash return' end;
  amt := 'AED ' || to_char(new.amount, 'FM999,999,999,990.00');
  if tg_op = 'INSERT' or (new.status = 'pending' and old.status = 'correction_requested') then
    insert into in_app_notifications(company_id, user_id, title, body, link, severity, dedupe_key)
      select new.company_id, p.id, what || ' to confirm: ' || coalesce(emp_name, 'employee'), amt || coalesce(' · ' || left(new.purpose, 120), ''),
             '/expenses?tab=petty&open=' || new.id, 'warning', 'petty:' || new.id || ':' || extract(epoch from now())::bigint
      from profiles p
      where p.company_id = new.company_id and p.is_active and p.id is distinct from emp_user
        and exists (select 1 from role_permissions rp where rp.role = p.role and rp.permission in ('expenses.approve','approvals.decide'))
      on conflict do nothing;
  elsif new.status is distinct from old.status and new.status in ('approved','rejected','correction_requested') and emp_user is not null then
    insert into in_app_notifications(company_id, user_id, title, body, link, severity, dedupe_key)
      values (new.company_id, emp_user,
        what || case new.status when 'approved' then ' confirmed' when 'rejected' then ' not accepted' else ': correction needed' end,
        concat_ws(' · ', amt, new.decision_note), '/me/expenses/petty-cash',
        case new.status when 'approved' then 'info' else 'warning' end, 'petty:' || new.id || ':' || new.status || ':' || extract(epoch from now())::bigint)
      on conflict do nothing;
  end if;
  return null;
end $$;
revoke execute on function petty_cash_requests_notify() from public, anon, authenticated;
drop trigger if exists petty_cash_requests_notify_t on petty_cash_requests;
create trigger petty_cash_requests_notify_t after insert or update on petty_cash_requests for each row execute function petty_cash_requests_notify();

drop trigger if exists audit_petty_cash_requests on petty_cash_requests;
create trigger audit_petty_cash_requests after insert or update or delete on petty_cash_requests for each row execute function audit_row();
drop trigger if exists audit_petty_cash_entries on petty_cash_entries;
create trigger audit_petty_cash_entries after insert or update or delete on petty_cash_entries for each row execute function audit_row();

-- ───────────── 7. balances ─────────────
create or replace function petty_wallet_balance(p_employee uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from petty_cash_entries where employee_id = p_employee and book = 'wallet' and company_id = current_company_id()
    and (p_employee = my_employee_id() or petty_can_manage() or has_permission('finance.view'))
$$;
create or replace function petty_reimbursement_due(p_employee uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from petty_cash_entries where employee_id = p_employee and book = 'reimbursement' and company_id = current_company_id()
    and (p_employee = my_employee_id() or petty_can_manage() or has_permission('finance.view'))
$$;
revoke all on function petty_wallet_balance(uuid) from public, anon;
revoke all on function petty_reimbursement_due(uuid) from public, anon;
grant execute on function petty_wallet_balance(uuid) to authenticated;
grant execute on function petty_reimbursement_due(uuid) to authenticated;

-- how much of each approved claim (paid from petty cash or the employee's own money) is settled
create or replace view expense_claim_settlement with (security_invoker = true) as
  select c.id as claim_id, c.company_id, c.employee_id, c.funded_by, c.status,
         round(c.amount + c.vat_amount, 2) as total,
         coalesce(-sum(e.amount) filter (where coalesce(e.reverses_kind, e.kind) = 'expense_settled'), 0) as from_petty_cash,
         coalesce(sum(e.amount) filter (where coalesce(e.reverses_kind, e.kind) = 'reimbursement_payable'), 0) as to_reimburse,
         round(c.amount + c.vat_amount, 2)
           - coalesce(-sum(e.amount) filter (where coalesce(e.reverses_kind, e.kind) = 'expense_settled'), 0)
           - coalesce(sum(e.amount) filter (where coalesce(e.reverses_kind, e.kind) = 'reimbursement_payable'), 0) as unsettled
  from expense_claims c left join petty_cash_entries e on e.claim_id = c.id
  where c.funded_by in ('petty_cash','personal')
  group by c.id;

-- one row per employee with petty cash activity: the wallet, from the ledger only (no stored, editable balance)
create or replace view petty_cash_wallets with (security_invoker = true) as
  with l as (
    select employee_id, company_id,
      sum(amount) filter (where book = 'wallet') as available,
      sum(amount) filter (where coalesce(reverses_kind, kind) = 'received') as received,
      -sum(amount) filter (where coalesce(reverses_kind, kind) = 'expense_settled') as settled,
      -sum(amount) filter (where coalesce(reverses_kind, kind) = 'returned') as returned,
      sum(amount) filter (where coalesce(reverses_kind, kind) = 'adjustment') as adjusted,
      sum(amount) filter (where book = 'reimbursement') as reimbursement_due,
      -sum(amount) filter (where coalesce(reverses_kind, kind) = 'reimbursement_paid') as reimbursed,
      max(entry_date) as last_entry
    from petty_cash_entries group by employee_id, company_id),
  r as (
    select employee_id, sum(amount) filter (where kind = 'received') as pending_received, sum(amount) filter (where kind = 'return') as pending_returns,
           count(*) as pending_requests
    from petty_cash_requests where status = 'pending' group by employee_id),
  c as (
    select employee_id, sum(amount + vat_amount) as pending_expenses, count(*) as pending_claims
    from expense_claims where status = 'pending' and funded_by = 'petty_cash' group by employee_id),
  s as (select employee_id, sum(unsettled) as awaiting_settlement from expense_claim_settlement where status = 'approved' and unsettled > 0 group by employee_id)
  select coalesce(l.employee_id, r.employee_id, c.employee_id, s.employee_id) as employee_id,
         coalesce(l.available, 0) as available, coalesce(l.received, 0) as received, coalesce(l.settled, 0) as settled,
         coalesce(l.returned, 0) as returned, coalesce(l.adjusted, 0) as adjusted, coalesce(l.reimbursement_due, 0) as reimbursement_due,
         coalesce(l.reimbursed, 0) as reimbursed, coalesce(r.pending_received, 0) as pending_received, coalesce(r.pending_returns, 0) as pending_returns,
         coalesce(r.pending_requests, 0) as pending_requests, coalesce(c.pending_expenses, 0) as pending_expenses, coalesce(c.pending_claims, 0) as pending_claims,
         coalesce(s.awaiting_settlement, 0) as awaiting_settlement, l.last_entry
  from l full join r on r.employee_id = l.employee_id
       full join c on c.employee_id = coalesce(l.employee_id, r.employee_id)
       full join s on s.employee_id = coalesce(l.employee_id, r.employee_id, c.employee_id);
-- signed-out callers get nothing (Supabase grants new objects to anon by default); signed-in users read through RLS
revoke all on petty_cash_entries, petty_cash_requests, petty_cash_wallets, expense_claim_settlement from anon;
grant select on petty_cash_wallets, expense_claim_settlement to authenticated;

-- ───────────── 8. posting (internal) ─────────────
-- Inserts one ledger row for one business event; the same event again returns the row already posted.
create or replace function petty_post(p_company uuid, p_employee uuid, p_kind text, p_amount numeric, p_date date, p_desc text, p_event text,
  p_method text default null, p_bank uuid default null, p_project uuid default null, p_claim uuid default null, p_request uuid default null,
  p_document uuid default null, p_reference text default null, p_notes text default null, p_reverses uuid default null, p_reverses_kind text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare id uuid; bk text;
begin
  bk := case when coalesce(p_reverses_kind, p_kind) in ('reimbursement_payable','reimbursement_paid') then 'reimbursement' else 'wallet' end;
  insert into petty_cash_entries(company_id, employee_id, book, kind, reverses_kind, amount, entry_date, description, reference, method, bank_id, project_id,
      claim_id, request_id, document_id, reverses_id, source_event, notes, created_by, approved_by)
    values (p_company, p_employee, bk, p_kind, p_reverses_kind, round(p_amount, 2), p_date, left(p_desc, 300), left(nullif(btrim(coalesce(p_reference, '')), ''), 120),
      p_method, p_bank, p_project, p_claim, p_request, p_document, p_reverses, p_event, left(nullif(btrim(coalesce(p_notes, '')), ''), 2000), auth.uid(), auth.uid())
    on conflict (company_id, source_event) do nothing
    returning petty_cash_entries.id into id;
  if id is null then select e.id into id from petty_cash_entries e where e.company_id = p_company and e.source_event = p_event; end if;
  return id;
end $$;
revoke all on function petty_post(uuid, uuid, text, numeric, date, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text) from public, anon, authenticated;

-- checks shared by the actions: approver, employee of this company, company account
create or replace function petty_check(p_employee uuid, p_bank uuid, p_project uuid) returns uuid language plpgsql stable security definer set search_path = public as $$
declare co uuid := current_company_id();
begin
  if not petty_can_manage() then raise exception 'You are not allowed to manage petty cash.'; end if;
  if not exists (select 1 from employees where id = p_employee and company_id = co) then raise exception 'Employee not found.'; end if;
  if p_bank is not null and not exists (select 1 from banks where id = p_bank and company_id = co and is_account) then raise exception 'Choose one of the company''s accounts.'; end if;
  if p_project is not null and not exists (select 1 from projects where id = p_project and company_id = co) then raise exception 'Project not found.'; end if;
  return co;
end $$;
revoke all on function petty_check(uuid, uuid, uuid) from public, anon, authenticated;

-- one employee's wallet changes one at a time (two approvers, a retry): the balance check and the posting are atomic
create or replace function petty_lock(p_employee uuid) returns void language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('petty:' || p_employee::text, 0))
$$;
revoke all on function petty_lock(uuid) from public, anon, authenticated;

-- ───────────── 9. actions ─────────────
-- Issue petty cash: the approver confirms the money was handed over. Credits the wallet once; when the company account
-- it came from is given, that account's cash goes down once (bank_transactions, source petty_cash).
create or replace function petty_issue(p_employee uuid, p_amount numeric, p_date date, p_method text, p_bank uuid, p_project uuid,
  p_purpose text, p_reference text, p_notes text, p_document uuid, p_key uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare co uuid := petty_check(p_employee, p_bank, p_project);
begin
  if p_key is null then raise exception 'Missing request key.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'Enter an amount greater than zero.'; end if;
  if p_date is null or p_date > current_date + 1 then raise exception 'Enter the date the money was handed over.'; end if;
  if nullif(btrim(coalesce(p_purpose, '')), '') is null then raise exception 'Give the purpose of the petty cash.'; end if;
  perform petty_lock(p_employee);
  return petty_post(co, p_employee, 'received', p_amount, p_date, btrim(p_purpose), 'issue:' || p_key, p_method, p_bank, p_project, null, null, p_document, p_reference, p_notes);
end $$;

-- An approver confirms (or refuses) what an employee reported. A report of money received is credited once: matched to a
-- hand-over the company already recorded (p_link), or posted now. A return is taken off the wallet and, when the company
-- account it went into is given, added to that account's cash once.
create or replace function petty_decide_request(p_request uuid, p_decision text, p_note text, p_link uuid, p_bank uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r petty_cash_requests; note text := nullif(btrim(coalesce(p_note, '')), ''); eid uuid; avail numeric; le petty_cash_entries;
begin
  if not petty_can_manage() then raise exception 'You are not allowed to manage petty cash.'; end if;
  if p_decision not in ('approved','rejected','correction_requested') then raise exception 'Unknown decision.'; end if;
  select * into r from petty_cash_requests where id = p_request and company_id = current_company_id() for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status = 'approved' and p_decision = 'approved' then return r.entry_id; end if;           -- second click: same result
  if r.status <> 'pending' then raise exception 'This request is % and cannot be decided now.', replace(r.status, '_', ' '); end if;
  if exists (select 1 from employees e where e.id = r.employee_id and e.user_id = auth.uid()) then raise exception 'You cannot confirm your own petty cash.'; end if;
  if p_decision <> 'approved' and note is null then raise exception 'Give a reason so the employee knows what to fix.'; end if;
  if p_bank is not null and not exists (select 1 from banks where id = p_bank and company_id = r.company_id and is_account) then raise exception 'Choose one of the company''s accounts.'; end if;
  perform set_config('app.petty_decision', 'on', true);
  if p_decision = 'approved' then
    perform petty_lock(r.employee_id);
    if r.kind = 'received' then
      if p_link is not null then
        select * into le from petty_cash_entries where id = p_link and company_id = r.company_id;
        if not found or le.employee_id <> r.employee_id or le.kind <> 'received' then raise exception 'Choose a hand-over to this employee.'; end if;
        if exists (select 1 from petty_cash_entries x where x.reverses_id = le.id) then raise exception 'That hand-over was reversed.'; end if;
        if exists (select 1 from petty_cash_requests q where q.entry_id = le.id and q.status = 'approved' and q.id <> r.id) then raise exception 'That hand-over is already matched to another report.'; end if;
        eid := le.id;
        update petty_cash_requests set status = 'approved', entry_id = eid, linked = true, decided_by = auth.uid(), decided_at = now(), decision_note = note where id = r.id;
      else
        eid := petty_post(r.company_id, r.employee_id, 'received', r.amount, r.entry_date, coalesce(r.purpose, 'Petty cash received'), 'request:' || r.id,
          r.method, p_bank, r.project_id, null, r.id, r.document_id, r.reference, concat_ws(E'\n', 'Reported by the employee' || coalesce(' (from ' || r.counterparty || ')', '') || '.', note));
        update petty_cash_requests set status = 'approved', entry_id = eid, decided_by = auth.uid(), decided_at = now(), decision_note = note where id = r.id;
      end if;
    else
      avail := petty_wallet_balance(r.employee_id);
      if r.amount > avail then raise exception 'The return (AED %) is more than the petty cash the employee holds (AED %).', to_char(r.amount, 'FM999,999,990.00'), to_char(avail, 'FM999,999,990.00'); end if;
      eid := petty_post(r.company_id, r.employee_id, 'returned', -r.amount, r.entry_date, coalesce(r.purpose, 'Unused petty cash returned'), 'request:' || r.id,
        r.method, p_bank, r.project_id, null, r.id, r.document_id, r.reference, note);
      update petty_cash_requests set status = 'approved', entry_id = eid, decided_by = auth.uid(), decided_at = now(), decision_note = note where id = r.id;
    end if;
  else
    update petty_cash_requests set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = note where id = r.id;
  end if;
  perform set_config('app.petty_decision', '', true);
  return eid;
end $$;

-- An approver records unused petty cash handed back (no employee report needed).
create or replace function petty_record_return(p_employee uuid, p_amount numeric, p_date date, p_method text, p_bank uuid, p_reference text, p_notes text, p_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare co uuid := petty_check(p_employee, p_bank, null); avail numeric;
begin
  if p_key is null then raise exception 'Missing request key.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  perform petty_lock(p_employee);
  if exists (select 1 from petty_cash_entries where company_id = co and source_event = 'return:' || p_key) then
    return (select id from petty_cash_entries where company_id = co and source_event = 'return:' || p_key);
  end if;
  avail := petty_wallet_balance(p_employee);
  if p_amount > avail then raise exception 'The return (AED %) is more than the petty cash the employee holds (AED %).', to_char(p_amount, 'FM999,999,990.00'), to_char(avail, 'FM999,999,990.00'); end if;
  return petty_post(co, p_employee, 'returned', -p_amount, coalesce(p_date, current_date), 'Unused petty cash returned', 'return:' || p_key, p_method, p_bank, null, null, null, null, p_reference, p_notes);
end $$;

-- Settle (part of) an approved claim: from the employee's petty cash (wallet down, no company cash moves) and/or as money
-- the company owes the employee (only when the approver confirms the employee paid it). Never more than is unsettled,
-- never more petty cash than the employee holds (no negative wallet).
create or replace function petty_settle_claim(p_claim uuid, p_petty numeric, p_personal numeric, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare c expense_claims; s expense_claim_settlement; avail numeric; pet numeric := round(coalesce(p_petty, 0), 2); per numeric := round(coalesce(p_personal, 0), 2);
begin
  if not petty_can_manage() then raise exception 'You are not allowed to settle expenses.'; end if;
  if p_key is null or length(p_key) > 150 then raise exception 'Missing request key.'; end if;
  select * into c from expense_claims where id = p_claim and company_id = current_company_id() for update;
  if not found then raise exception 'Expense claim not found.'; end if;
  if c.status <> 'approved' then raise exception 'Approve the expense before settling it.'; end if;
  if c.funded_by is null or c.funded_by = 'company' then raise exception 'This expense was paid by the company: there is nothing to settle.'; end if;
  if pet < 0 or per < 0 then raise exception 'Amounts cannot be negative.'; end if;
  if pet = 0 and per = 0 then return; end if;
  perform petty_lock(c.employee_id);
  if exists (select 1 from petty_cash_entries where company_id = c.company_id
             and source_event in ('settle:' || p_key || ':petty', 'settle:' || p_key || ':personal')) then return; end if;   -- retry
  select * into s from expense_claim_settlement where claim_id = c.id;
  if pet + per > s.unsettled + 0.004 then raise exception 'Only AED % of this expense is still to settle.', to_char(s.unsettled, 'FM999,999,990.00'); end if;
  if pet > 0 then
    avail := petty_wallet_balance(c.employee_id);
    if pet > avail + 0.004 then raise exception 'The employee holds AED % of petty cash: settle the rest another way.', to_char(avail, 'FM999,999,990.00'); end if;
    perform petty_post(c.company_id, c.employee_id, 'expense_settled', -pet, c.spent_on, left('Expense: ' || coalesce(c.supplier_name || ' · ', '') || c.description, 300),
      'settle:' || p_key || ':petty', null, null, c.project_id, c.id, null, c.receipt_document_id, c.reference);
  end if;
  if per > 0 then
    perform petty_post(c.company_id, c.employee_id, 'reimbursement_payable', per, c.spent_on, left('Paid by the employee: ' || coalesce(c.supplier_name || ' · ', '') || c.description, 300),
      'settle:' || p_key || ':personal', null, null, c.project_id, c.id, null, c.receipt_document_id, c.reference);
  end if;
end $$;

-- Pay back (part of) what the company owes the employee for expenses they paid themselves.
create or replace function petty_reimburse(p_employee uuid, p_amount numeric, p_date date, p_method text, p_bank uuid, p_reference text, p_notes text, p_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare co uuid := petty_check(p_employee, p_bank, null); due numeric;
begin
  if p_key is null then raise exception 'Missing request key.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  perform petty_lock(p_employee);
  if exists (select 1 from petty_cash_entries where company_id = co and source_event = 'reimburse:' || p_key) then
    return (select id from petty_cash_entries where company_id = co and source_event = 'reimburse:' || p_key);
  end if;
  due := petty_reimbursement_due(p_employee);
  if p_amount > due + 0.004 then raise exception 'The company owes this employee AED %.', to_char(due, 'FM999,999,990.00'); end if;
  return petty_post(co, p_employee, 'reimbursement_paid', -p_amount, coalesce(p_date, current_date), 'Reimbursement paid', 'reimburse:' || p_key, p_method, p_bank, null, null, null, null, p_reference, p_notes);
end $$;

-- An authorised correction of the wallet (with a reason); it may not take the wallet below zero.
create or replace function petty_adjust(p_employee uuid, p_amount numeric, p_date date, p_reason text, p_key uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare co uuid := petty_check(p_employee, null, null);
begin
  if p_key is null then raise exception 'Missing request key.'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Enter the adjustment (+ to add, − to take off).'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give the reason for the adjustment.'; end if;
  perform petty_lock(p_employee);
  if not exists (select 1 from petty_cash_entries where company_id = co and source_event = 'adjust:' || p_key)
     and petty_wallet_balance(p_employee) + p_amount < -0.004 then raise exception 'That would take the petty cash below zero.'; end if;
  return petty_post(co, p_employee, 'adjustment', p_amount, coalesce(p_date, current_date), left('Adjustment: ' || btrim(p_reason), 300), 'adjust:' || p_key);
end $$;

-- Reverse a posted row (a mistake): an opposite row in the same book, linked to it; its company cash is reversed too.
-- A row is reversed at most once; the posted row itself is never edited or deleted.
create or replace function petty_reverse(p_entry uuid, p_reason text) returns uuid language plpgsql security definer set search_path = public as $$
declare e petty_cash_entries; rid uuid;
begin
  if not petty_can_manage() then raise exception 'You are not allowed to manage petty cash.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give the reason for the reversal.'; end if;
  select * into e from petty_cash_entries where id = p_entry and company_id = current_company_id();
  if not found then raise exception 'Entry not found.'; end if;
  if e.kind = 'reversal' then raise exception 'A reversal cannot be reversed: post the entry again instead.'; end if;
  perform petty_lock(e.employee_id);
  select id into rid from petty_cash_entries where reverses_id = e.id;
  if found then return rid; end if;
  if e.book = 'wallet' and petty_wallet_balance(e.employee_id) - e.amount < -0.004 then
    raise exception 'Reversing this would take the petty cash below zero (some of it was already spent or returned).';
  end if;
  if e.book = 'reimbursement' and petty_reimbursement_due(e.employee_id) - e.amount < -0.004 then
    raise exception 'Reversing this would leave the company owing less than nothing: reverse the reimbursement payment first.';
  end if;
  rid := petty_post(e.company_id, e.employee_id, 'reversal', -e.amount, current_date, left('Reversal: ' || e.description || ' · ' || btrim(p_reason), 300), 'reverse:' || e.id,
    e.method, e.bank_id, e.project_id, e.claim_id, e.request_id, null, e.reference, btrim(p_reason), e.id, e.kind);
  return rid;
end $$;

do $$ declare f text; begin
  foreach f in array array['petty_issue(uuid, numeric, date, text, uuid, uuid, text, text, text, uuid, uuid)', 'petty_decide_request(uuid, text, text, uuid, uuid)',
    'petty_record_return(uuid, numeric, date, text, uuid, text, text, uuid)', 'petty_settle_claim(uuid, numeric, numeric, text)',
    'petty_reimburse(uuid, numeric, date, text, uuid, text, text, uuid)', 'petty_adjust(uuid, numeric, date, text, uuid)', 'petty_reverse(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ───────────── 10. approving a claim: settled by whose money paid ─────────────
-- Unchanged for earlier claims (no funded_by) and company-paid claims. For petty cash / the employee's own money the
-- company expense is recognised once with no company account (no second cash movement), then settled: from petty cash
-- (by default as much as the employee holds; the rest waits for settlement unless the approver confirms the employee
-- paid it), or owed to the employee (and, with p_bank, paid back now from that account).
drop function if exists decide_expense_claim(uuid, text, text, text, uuid, uuid, uuid);
create or replace function decide_expense_claim(
  p_claim uuid, p_decision text, p_note text default null,
  p_category text default null, p_project uuid default null, p_supplier uuid default null, p_bank uuid default null,
  p_petty numeric default null, p_personal numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare c expense_claims; exp_id uuid; note text := nullif(btrim(coalesce(p_note, '')), ''); total numeric; pet numeric; per numeric; fund boolean;
begin
  if not (has_permission('expenses.approve') or has_permission('approvals.decide')) then raise exception 'You are not allowed to approve employee expenses.'; end if;
  if p_decision not in ('approved','rejected','correction_requested') then raise exception 'Unknown decision.'; end if;
  select * into c from expense_claims where id = p_claim and company_id = current_company_id() for update;
  if not found then raise exception 'Expense claim not found.'; end if;
  if c.status = 'approved' and p_decision = 'approved' then return c.expense_id; end if;      -- second click: same result
  if c.status <> 'pending' then raise exception 'This claim is % and cannot be decided now.', replace(c.status, '_', ' '); end if;
  if exists (select 1 from employees e where e.id = c.employee_id and e.user_id = auth.uid()) then raise exception 'You cannot decide your own expense claim.'; end if;
  if p_decision <> 'approved' and note is null then raise exception 'Give a reason so the employee knows what to fix.'; end if;
  if note is not null and length(note) > 2000 then raise exception 'The note is too long.'; end if;
  fund := c.funded_by in ('petty_cash','personal');
  perform set_config('app.claim_decision', 'on', true);
  if p_decision = 'approved' then
    if p_category is not null and p_category not in ('material','labour','transport','fuel','equipment','subcontract','accommodation','food','maintenance','other') then raise exception 'Unknown category.'; end if;
    if coalesce(p_project, c.project_id) is not null and not exists (select 1 from projects where id = coalesce(p_project, c.project_id) and company_id = c.company_id) then raise exception 'Project not found.'; end if;
    if p_supplier is not null and not exists (select 1 from suppliers where id = p_supplier and company_id = c.company_id) then raise exception 'Supplier not found.'; end if;
    if p_bank is not null and not exists (select 1 from banks where id = p_bank and company_id = c.company_id) then raise exception 'Account not found.'; end if;
    insert into project_expenses(company_id, project_id, spent_on, category, supplier_id, supplier_name, supplier_trn, description,
        amount, vat_amount, vat_rate, reference, quantity, items, notes, payment_status, payment_method, paid_from_bank_id,
        employee_id, receipt_document_id, source, ocr_suggested, verified_at, verified_by, approval_status, created_by, expense_claim_id, card_id)
      values (c.company_id, coalesce(p_project, c.project_id), c.spent_on, coalesce(p_category, c.category), p_supplier, c.supplier_name, c.supplier_trn, c.description,
        c.amount, c.vat_amount, case when c.amount > 0 then round(c.vat_amount / c.amount * 100, 2) end, c.reference, c.quantity, c.items,
        left(concat_ws(E'\n', 'Employee expense claim, approved' || coalesce(': ' || note, '') || '.',
          case c.funded_by when 'petty_cash' then 'Paid from the employee''s petty cash.' when 'personal' then 'Paid with the employee''s own money (reimbursed through petty cash).' end, c.notes), 2000),
        'paid', case c.paid_with when 'bank_transfer' then 'bank_transfer' when 'card' then 'card' when 'cash' then 'cash' else 'other' end,
        case when fund then null else p_bank end,      -- petty cash / own money: no company account moves now (no double count)
        c.employee_id, c.receipt_document_id, c.source, c.ocr_suggested, now(), auth.uid(), 'approved', c.submitted_by, c.id, c.card_id)
      returning id into exp_id;
    update expense_claims set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = note,
      expense_id = exp_id, category = coalesce(p_category, category) where id = c.id;
    if fund then
      total := round(c.amount + c.vat_amount, 2);
      perform petty_lock(c.employee_id);
      if c.funded_by = 'petty_cash' then
        pet := least(coalesce(p_petty, petty_wallet_balance(c.employee_id)), total); per := least(coalesce(p_personal, 0), total - greatest(pet, 0));
      else
        pet := least(coalesce(p_petty, 0), total); per := coalesce(p_personal, total - greatest(pet, 0));
      end if;
      pet := greatest(pet, 0); per := greatest(per, 0);
      perform petty_settle_claim(c.id, pet, per, 'claim:' || c.id || ':approve');
      if c.funded_by = 'personal' and p_bank is not null and per > 0 then      -- paid back straight away
        perform petty_post(c.company_id, c.employee_id, 'reimbursement_paid', -per, current_date, left('Reimbursement paid: ' || c.description, 300), 'claim:' || c.id || ':repay',
          'bank_transfer', p_bank, null, c.id, null, null, c.reference);
      end if;
    end if;
  else
    update expense_claims set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = note where id = c.id;
  end if;
  perform set_config('app.claim_decision', '', true);
  return exp_id;
end $$;
revoke all on function decide_expense_claim(uuid, text, text, text, uuid, uuid, uuid, numeric, numeric) from public, anon;
grant execute on function decide_expense_claim(uuid, text, text, text, uuid, uuid, uuid, numeric, numeric) to authenticated;

-- ───────────── 11. the petty cash statement can be shared on WhatsApp (free sharing) ─────────────
alter table document_shares drop constraint if exists document_shares_doc_kind_check;
alter table document_shares add constraint document_shares_doc_kind_check check (doc_kind in (
  'payslip','salary_receipt','salary_statement','quotation','invoice','delivery_note','payment_reminder',
  'customer_receipt','customer_statement','employee_document','petty_cash_statement'));
create or replace function share_kind_allowed(kind text) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when kind in ('payslip','salary_receipt','salary_statement') then has_permission('salary.view')
    when kind = 'employee_document' then has_permission('documents.view') and has_permission('employees.view_sensitive')
    when kind = 'petty_cash_statement' then petty_can_manage()
    else has_permission('finance.view') end
$$;
revoke all on function share_kind_allowed(text) from public, anon;
grant execute on function share_kind_allowed(text) to authenticated;
