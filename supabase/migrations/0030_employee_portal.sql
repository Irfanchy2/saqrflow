-- 0030: Employee Portal & employee expense claims.
-- Reuses the existing employee role, employees.user_id link, salary / advances / attendance / leave tables, documents vault
-- and project_expenses. Additive only: new columns (nullable or with defaults), new tables, new policies and functions.
-- No existing row is deleted or changed.
--
--  • An "employee" login sees ONLY its own employee record, salary, advances, attendance, leave, documents and expense
--    claims (RLS), and none of the company-wide configuration or colleagues' profiles.
--  • Employees submit expense CLAIMS (expense_claims). A claim never touches project_expenses (nor Tally exports) until an
--    approver approves it; approval adds it to project_expenses exactly once (unique link both ways), verified and
--    approved, with the employee and the original receipt attached.
--  • Every submission, edit, approval, rejection and correction request is kept (expense_claim_events + audit_logs).
--  • Optional self check-in / check-out (off until the company turns it on), validated on the server.

-- ───────────── permission: who may approve employee expenses ─────────────
insert into role_permissions(role, permission) values
  ('super_admin','expenses.approve'),('company_owner','expenses.approve'),('accountant','expenses.approve')
on conflict do nothing;

-- ───────────── helpers ─────────────
create or replace function my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select e.id from employees e
  where e.user_id = auth.uid() and e.company_id = current_company_id() and e.deleted_at is null
  limit 1
$$;

create or replace function is_employee_role() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'employee' from profiles p where p.id = auth.uid() and p.is_active), false)
$$;

-- one login ↔ one employee record (created only when existing data already satisfies it; never changes rows)
do $$ begin
  if not exists (select 1 from employees where user_id is not null and deleted_at is null group by user_id having count(*) > 1) then
    create unique index if not exists employees_user_uidx on employees(user_id) where user_id is not null and deleted_at is null;
  end if;
end $$;

-- ───────────── employees read their OWN HR records ─────────────
do $$ declare t text; begin
  foreach t in array array['salary_payments','employee_advances','employee_compensation','attendance_records','leave_records'] loop
    execute format('drop policy if exists self_select on %I', t);
    execute format('create policy self_select on %I for select to authenticated using (company_id = current_company_id() and employee_id = my_employee_id())', t);
  end loop;
end $$;

-- ───────────── employees see nothing company-wide (colleagues, configuration) ─────────────
-- Restrictive policies: they only ever narrow what the existing policies allow, and only for the employee role.
drop policy if exists employee_own_profile on profiles;
create policy employee_own_profile on profiles as restrictive for select to authenticated using (not is_employee_role() or id = auth.uid());
drop policy if exists employee_settings on app_settings;
create policy employee_settings on app_settings as restrictive for select to authenticated using (
  not is_employee_role() or key like 'portal.%' or key like 'branding.%'      -- letterhead on their own payslips
  or key in ('ocr.provider','ai.provider','ai.ocr_provider','ai.redact_ids','ocr.turbo'));
do $$ declare t text; begin
  foreach t in array array['custom_field_defs','custom_statuses','document_number_formats','public_forms','document_type_mappings','saved_views','share_links','approval_requests'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists employee_none on %I', t);
      execute format('create policy employee_none on %I as restrictive for select to authenticated using (not is_employee_role())', t);
    end if;
  end loop;
end $$;

-- ───────────── attendance: optional self check-in / check-out ─────────────
alter table attendance_records
  add column if not exists check_in_at timestamptz,
  add column if not exists check_out_at timestamptz,
  add column if not exists source text not null default 'admin' check (source in ('admin','self'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_checkout_after_checkin') then
    alter table attendance_records add constraint attendance_checkout_after_checkin
      check (check_out_at is null or (check_in_at is not null and check_out_at >= check_in_at)) not valid;
  end if;
end $$;

-- The employee's own "check in" / "check out" for today (the company's date), server time only. Off unless the company
-- turned it on (app_settings portal.checkin = true). Employees cannot otherwise write attendance (RLS).
create or replace function attendance_punch(p_kind text) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare emp uuid := my_employee_id(); cid uuid := current_company_id(); tz text; d date; r attendance_records;
begin
  if emp is null then raise exception 'This login is not linked to an employee record.'; end if;
  if coalesce(approval_setting(cid, 'portal.checkin'), 'false'::jsonb) <> 'true'::jsonb then raise exception 'Check-in is not turned on for your company.'; end if;
  if p_kind not in ('in','out') then raise exception 'Unknown attendance action.'; end if;
  select coalesce(timezone, 'Asia/Dubai') into tz from companies where id = cid;
  d := (now() at time zone tz)::date;
  select * into r from attendance_records where employee_id = emp and work_date = d for update;
  if p_kind = 'in' then
    if found and r.check_in_at is not null then raise exception 'You already checked in today at %.', to_char(r.check_in_at at time zone tz, 'HH24:MI'); end if;
    if found and r.status in ('leave','holiday') then raise exception 'Today is recorded as %; ask HR to change it.', r.status; end if;
    insert into attendance_records(company_id, employee_id, work_date, status, check_in_at, source)
      values (cid, emp, d, 'present', now(), 'self')
      on conflict (employee_id, work_date) do update set check_in_at = now(), status = 'present', source = 'self'
      returning * into r;
  else
    if not found or r.check_in_at is null then raise exception 'Check in first.'; end if;
    if r.check_out_at is not null then raise exception 'You already checked out today at %.', to_char(r.check_out_at at time zone tz, 'HH24:MI'); end if;
    update attendance_records set check_out_at = now() where id = r.id returning * into r;
  end if;
  return r;
end $$;
revoke all on function attendance_punch(text) from public, anon;
grant execute on function attendance_punch(text) to authenticated;

-- ───────────── advances: no duplicate when a form is sent twice ─────────────
alter table employee_advances add column if not exists idempotency_key uuid;
create unique index if not exists employee_advances_idem_uidx on employee_advances(company_id, idempotency_key) where idempotency_key is not null;

-- audit trail for attendance and leave as well (salary tables are already audited, amounts redacted)
drop trigger if exists audit_attendance_records on attendance_records;
create trigger audit_attendance_records after insert or update or delete on attendance_records for each row execute function audit_row();
drop trigger if exists audit_leave_records on leave_records;
create trigger audit_leave_records after insert or update or delete on leave_records for each row execute function audit_row();

-- ───────────── employee expense claims ─────────────
create table if not exists expense_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,
  submitted_by uuid references profiles(id) on delete set null default auth.uid(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','correction_requested','withdrawn')),
  spent_on date not null,
  category text not null default 'other' check (category in ('material','labour','transport','fuel','equipment','subcontract','accommodation','food','maintenance','other')),
  supplier_name text check (length(supplier_name) <= 200),
  supplier_trn text check (supplier_trn is null or supplier_trn ~ '^[0-9]{15}$'),
  reference text check (length(reference) <= 120),
  description text not null check (length(description) between 1 and 500),
  amount numeric(14,2) not null check (amount > 0),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  paid_with text not null default 'cash' check (paid_with in ('cash','card','bank_transfer','other')),
  quantity numeric(14,3) check (quantity is null or quantity > 0),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200),
  notes text check (length(notes) <= 2000),
  receipt_document_id uuid references documents(id) on delete set null,
  source text not null default 'manual' check (source in ('manual','scan')),
  ocr_suggested jsonb,
  decision_note text check (length(decision_note) <= 2000),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  expense_id uuid references project_expenses(id) on delete set null,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists expense_claims_expense_uidx on expense_claims(expense_id) where expense_id is not null;
create unique index if not exists expense_claims_idem_uidx on expense_claims(company_id, idempotency_key) where idempotency_key is not null;
create index if not exists expense_claims_queue_idx on expense_claims(company_id, status, created_at desc);
create index if not exists expense_claims_employee_idx on expense_claims(employee_id, created_at desc);

-- the approved company expense points back at its claim: one claim → at most one expense, and the reverse
alter table project_expenses add column if not exists expense_claim_id uuid references expense_claims(id) on delete set null;
create unique index if not exists project_expenses_claim_uidx on project_expenses(expense_claim_id) where expense_claim_id is not null;

alter table expense_claims enable row level security;
drop policy if exists ec_select on expense_claims;
create policy ec_select on expense_claims for select to authenticated using (
  company_id = current_company_id() and (employee_id = my_employee_id() or has_permission('expenses.approve') or has_permission('finance.view')));
drop policy if exists ec_insert on expense_claims;
create policy ec_insert on expense_claims for insert to authenticated with check (
  company_id = current_company_id() and employee_id = my_employee_id() and status = 'pending'
  and expense_id is null and decided_by is null and decided_at is null and decision_note is null and receipt_document_id is null);
drop policy if exists ec_update on expense_claims;
create policy ec_update on expense_claims for update to authenticated
  using (company_id = current_company_id() and employee_id = my_employee_id() and status in ('pending','correction_requested'))
  with check (company_id = current_company_id() and employee_id = my_employee_id() and status in ('pending','withdrawn'));
-- no delete policy: claims are kept (an employee withdraws, an approver rejects)

-- Employees may edit their own claim only while it is pending or sent back for correction (a corrected claim goes back
-- to pending), or withdraw it. Decisions, the expense link and ownership change only through decide_expense_claim().
create or replace function expense_claims_guard() returns trigger language plpgsql set search_path = public as $$
declare deciding boolean := coalesce(current_setting('app.claim_decision', true), '') = 'on';
begin
  if auth.uid() is null then new.updated_at := now(); return new; end if;            -- service role / migrations
  if new.company_id is distinct from old.company_id or new.employee_id is distinct from old.employee_id
     or new.submitted_by is distinct from old.submitted_by or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception 'This claim cannot be moved to someone else.';
  end if;
  if deciding then
    if not (has_permission('expenses.approve') or has_permission('approvals.decide')) then raise exception 'You are not allowed to decide expense claims.'; end if;
  else
    if new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
       or new.decision_note is distinct from old.decision_note or new.expense_id is distinct from old.expense_id then
      raise exception 'Only an approver can decide an expense claim.';
    end if;
    -- the receipt is attached by the server after checking the file (it stores it as this claim's own document)
    if new.receipt_document_id is distinct from old.receipt_document_id then raise exception 'The receipt is attached by the server.'; end if;
    if old.status not in ('pending','correction_requested') then raise exception 'This claim was already %; it can no longer be changed.', replace(old.status, '_', ' '); end if;
    if new.status not in ('pending','withdrawn') then raise exception 'Only an approver can decide an expense claim.'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists expense_claims_guard_t on expense_claims;
create trigger expense_claims_guard_t before update on expense_claims for each row execute function expense_claims_guard();

create table if not exists expense_claim_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  claim_id uuid not null references expense_claims(id) on delete cascade,
  kind text not null check (kind in ('submitted','edited','resubmitted','withdrawn','approved','rejected','correction_requested')),
  note text check (length(note) <= 2000),
  actor uuid references profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists expense_claim_events_claim_idx on expense_claim_events(claim_id, created_at);
alter table expense_claim_events enable row level security;
drop policy if exists ece_select on expense_claim_events;
create policy ece_select on expense_claim_events for select to authenticated using (
  company_id = current_company_id() and exists (select 1 from expense_claims c where c.id = claim_id));
-- written only by the trigger below (no insert / update / delete policies)

create or replace function expense_claims_track() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; who text; emp_user uuid; emp_name text; total text; lnk text;
begin
  if tg_op = 'UPDATE' and auth.uid() is null and new.status is not distinct from old.status then return null; end if;   -- server attached the receipt
  select full_name into who from profiles where id = auth.uid();
  select e.user_id, e.full_name into emp_user, emp_name from employees e where e.id = new.employee_id;
  total := 'AED ' || to_char(new.amount + new.vat_amount, 'FM999,999,999,990.00');
  lnk := '/expenses?tab=claims&open=' || new.id;
  if tg_op = 'INSERT' then k := 'submitted';
  elsif new.status is distinct from old.status then
    k := case new.status when 'pending' then 'resubmitted' else new.status end;
  else k := 'edited'; end if;
  insert into expense_claim_events(company_id, claim_id, kind, note, actor, actor_name)
    values (new.company_id, new.id, k, case when k in ('approved','rejected','correction_requested') then new.decision_note end, auth.uid(), coalesce(who, emp_name));

  if k in ('submitted','resubmitted') then          -- tell everyone who can approve
    insert into in_app_notifications(company_id, user_id, title, body, link, severity, dedupe_key)
      select new.company_id, p.id, 'Expense claim to approve: ' || coalesce(emp_name, 'employee'), total || ' · ' || left(new.description, 120), lnk, 'warning',
             'claim:' || new.id || ':' || k || ':' || extract(epoch from now())::bigint
      from profiles p
      where p.company_id = new.company_id and p.is_active and p.id is distinct from emp_user
        and exists (select 1 from role_permissions rp where rp.role = p.role and rp.permission in ('expenses.approve','approvals.decide'))
      on conflict do nothing;
  elsif k in ('approved','rejected','correction_requested') and emp_user is not null then   -- tell the employee
    insert into in_app_notifications(company_id, user_id, title, body, link, severity, dedupe_key)
      values (new.company_id, emp_user,
              case k when 'approved' then 'Expense approved: ' when 'rejected' then 'Expense rejected: ' else 'Correction needed: ' end || left(new.description, 120),
              concat_ws(' · ', total, new.decision_note), '/me/expenses?open=' || new.id,
              case k when 'approved' then 'info' else 'warning' end, 'claim:' || new.id || ':' || k || ':' || extract(epoch from now())::bigint)
      on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists expense_claims_track_t on expense_claims;
create trigger expense_claims_track_t after insert or update on expense_claims for each row execute function expense_claims_track();
drop trigger if exists audit_expense_claims on expense_claims;
create trigger audit_expense_claims after insert or update or delete on expense_claims for each row execute function audit_row();

-- An approved claim is already approved: the expense threshold rule must not send it for approval a second time.
create or replace function needs_approval_before() returns trigger language plpgsql security definer set search_path = public as $$
declare lim jsonb;
begin
  if tg_table_name = 'project_expenses' then
    if new.expense_claim_id is not null then return new; end if;
    lim := approval_setting(new.company_id, 'approvals.expense_threshold');
    if jsonb_typeof(lim) = 'number' and (lim)::numeric > 0 and new.amount >= (lim)::numeric then new.approval_status := 'pending'; end if;
  elsif tg_table_name = 'cheques' then
    lim := approval_setting(new.company_id, 'approvals.cheque_threshold');
    if new.direction = 'outgoing' and jsonb_typeof(lim) = 'number' and (lim)::numeric > 0 and new.amount >= (lim)::numeric then new.approval_status := 'pending'; end if;
  elsif tg_table_name = 'invoices' then
    if new.doc_type = 'purchase_order' and approval_setting(new.company_id, 'approvals.po_required') = 'true'::jsonb and new.approval_status is null then new.approval_status := 'pending'; end if;
  end if;
  return new;
end $$;

-- Approve / reject / send back for correction. Approval adds the claim to the company's expenses exactly once (the claim
-- row is locked, the expense is linked both ways with unique indexes), verified and approved, with the employee and the
-- receipt. Rejecting or asking for a correction needs a reason. Nobody approves their own claim.
create or replace function decide_expense_claim(
  p_claim uuid, p_decision text, p_note text default null,
  p_category text default null, p_project uuid default null, p_supplier uuid default null, p_bank uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare c expense_claims; exp_id uuid; note text := nullif(btrim(coalesce(p_note, '')), '');
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
  perform set_config('app.claim_decision', 'on', true);
  if p_decision = 'approved' then
    if p_category is not null and p_category not in ('material','labour','transport','fuel','equipment','subcontract','accommodation','food','maintenance','other') then raise exception 'Unknown category.'; end if;
    if p_project is not null and not exists (select 1 from projects where id = p_project and company_id = c.company_id) then raise exception 'Project not found.'; end if;
    if p_supplier is not null and not exists (select 1 from suppliers where id = p_supplier and company_id = c.company_id) then raise exception 'Supplier not found.'; end if;
    if p_bank is not null and not exists (select 1 from banks where id = p_bank and company_id = c.company_id) then raise exception 'Account not found.'; end if;
    insert into project_expenses(company_id, project_id, spent_on, category, supplier_id, supplier_name, supplier_trn, description,
        amount, vat_amount, vat_rate, reference, quantity, items, notes, payment_status, payment_method, paid_from_bank_id,
        employee_id, receipt_document_id, source, ocr_suggested, verified_at, verified_by, approval_status, created_by, expense_claim_id)
      values (c.company_id, p_project, c.spent_on, coalesce(p_category, c.category), p_supplier, c.supplier_name, c.supplier_trn, c.description,
        c.amount, c.vat_amount, case when c.amount > 0 then round(c.vat_amount / c.amount * 100, 2) end, c.reference, c.quantity, c.items,
        left(concat_ws(E'\n', 'Employee expense claim, approved' || coalesce(': ' || note, '') || '.', c.notes), 2000),
        'paid', case c.paid_with when 'bank_transfer' then 'bank_transfer' when 'card' then 'card' when 'cash' then 'cash' else 'other' end, p_bank,
        c.employee_id, c.receipt_document_id, c.source, c.ocr_suggested, now(), auth.uid(), 'approved', c.submitted_by, c.id)
      returning id into exp_id;
    update expense_claims set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = note,
      expense_id = exp_id, category = coalesce(p_category, category) where id = c.id;
  else
    update expense_claims set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = note where id = c.id;
  end if;
  perform set_config('app.claim_decision', '', true);
  return exp_id;
end $$;
revoke all on function decide_expense_claim(uuid, text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function decide_expense_claim(uuid, text, text, text, uuid, uuid, uuid) to authenticated;

-- ───────────── claim receipts: visible to the employee and to approvers / finance ─────────────
alter table documents drop constraint if exists documents_owner_type_check;
alter table documents add constraint documents_owner_type_check check (owner_type in
  ('company','employee','project','asset','cheque','vault','lead','site_visit','work_order','expense_claim'));
create or replace function can_view_document(otype text, oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case otype
    when 'employee' then has_permission('employees.view_sensitive') or (oid is not null and is_own_employee(oid))
    when 'cheque'   then has_permission('finance.view')
    when 'expense_claim' then has_permission('finance.view') or has_permission('expenses.approve')
      or exists (select 1 from expense_claims c where c.id = oid and c.employee_id = my_employee_id())
    else has_permission('documents.view') end
$$;

-- ───────────── execution rights ─────────────
-- Signed-out visitors run nothing; trigger functions are not callable directly; helpers are used by RLS for signed-in users.
revoke execute on function my_employee_id(), is_employee_role() from public, anon;
grant execute on function my_employee_id(), is_employee_role() to authenticated;
revoke execute on function expense_claims_guard(), expense_claims_track() from public, anon, authenticated;
