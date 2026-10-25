-- 0033: Employee expense claims: an optional project, and the same expense cannot be sent twice.
-- Additive only: one nullable column, new functions and a trigger, and decide_expense_claim() using the employee's project
-- when the approver does not pick another one. No existing row is changed.
--
--  • An employee may say which project an expense was for. They see only the names of the company's current projects
--    (planning / active) through my_project_choices(), never project figures: the projects table stays closed to them.
--  • The database refuses a second claim for the same expense by the same employee (withdrawn and rejected claims do not
--    count): the same receipt number, or, for one sent without a receipt number, the same day, supplier and amounts.

alter table expense_claims add column if not exists project_id uuid references projects(id) on delete set null;
create index if not exists expense_claims_project_idx on expense_claims(project_id) where project_id is not null;

-- Project names an expense can be put on: current projects, plus any project already on one of the caller's own claims.
create or replace function my_project_choices() returns table (id uuid, name text, code text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.code from projects p
  where p.company_id = current_company_id() and p.deleted_at is null
    and (p.status in ('planning','active')
         or exists (select 1 from expense_claims c where c.project_id = p.id and c.employee_id = my_employee_id()))
    and (my_employee_id() is not null or has_permission('documents.view'))
  order by p.name
$$;
revoke all on function my_project_choices() from public, anon;
grant execute on function my_project_choices() to authenticated;

-- "INV-0042", "inv 42"… compare as one receipt number (same rule as normRef in lib/expenses/suppliers.ts)
create or replace function claim_ref_norm(s text) returns text language sql immutable set search_path = public as $$
  select regexp_replace(regexp_replace(lower(coalesce(s, '')), '[^a-z0-9]', '', 'g'), '^(invoice|inv|bill|receipt|no)+', '')
$$;
revoke all on function claim_ref_norm(text) from public, anon;
grant execute on function claim_ref_norm(text) to authenticated;

create or replace function expense_claims_check() returns trigger language plpgsql security definer set search_path = public as $$
declare d expense_claims; ref text := claim_ref_norm(new.reference); sup text := regexp_replace(lower(coalesce(new.supplier_name, '')), '[^a-z0-9]', '', 'g');
begin
  -- the project must be this company's; a new choice must be a current project
  if new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    if not exists (select 1 from projects p where p.id = new.project_id and p.company_id = new.company_id and p.deleted_at is null and p.status in ('planning','active')) then
      raise exception 'Choose one of the company''s current projects.';
    end if;
  end if;
  -- the same expense only once per employee (decisions and withdrawals are not new expenses)
  if new.status not in ('pending','correction_requested') then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.reference is not distinct from old.reference
     and new.spent_on = old.spent_on and new.amount = old.amount and new.vat_amount = old.vat_amount
     and new.supplier_name is not distinct from old.supplier_name then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('expense_claim:' || new.employee_id::text, 0));   -- two taps at once: one waits
  select * into d from expense_claims c
    where c.employee_id = new.employee_id and c.id <> new.id and c.status not in ('withdrawn','rejected')
      and ((ref <> '' and claim_ref_norm(c.reference) = ref)
        or (ref = '' and c.spent_on = new.spent_on and c.amount = new.amount and c.vat_amount = new.vat_amount
            and regexp_replace(lower(coalesce(c.supplier_name, '')), '[^a-z0-9]', '', 'g') = sup))
    order by c.created_at limit 1;
  if found then
    if ref <> '' and claim_ref_norm(d.reference) = ref then
      raise exception 'You already sent receipt % (%). Open it under My expenses instead of sending it again.', d.reference, to_char(d.spent_on, 'DD Mon YYYY');
    end if;
    raise exception 'You already sent this expense (% · AED %). Open it under My expenses instead of sending it again. If it is a different expense, add its receipt number.',
      to_char(d.spent_on, 'DD Mon YYYY'), to_char(d.amount + d.vat_amount, 'FM999,999,990.00');
  end if;
  return new;
end $$;
revoke execute on function expense_claims_check() from public, anon, authenticated;
drop trigger if exists expense_claims_check_t on expense_claims;
create trigger expense_claims_check_t before insert or update on expense_claims for each row execute function expense_claims_check();

-- An approver who picks no project keeps the employee's choice.
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
    if coalesce(p_project, c.project_id) is not null and not exists (select 1 from projects where id = coalesce(p_project, c.project_id) and company_id = c.company_id) then raise exception 'Project not found.'; end if;
    if p_supplier is not null and not exists (select 1 from suppliers where id = p_supplier and company_id = c.company_id) then raise exception 'Supplier not found.'; end if;
    if p_bank is not null and not exists (select 1 from banks where id = p_bank and company_id = c.company_id) then raise exception 'Account not found.'; end if;
    insert into project_expenses(company_id, project_id, spent_on, category, supplier_id, supplier_name, supplier_trn, description,
        amount, vat_amount, vat_rate, reference, quantity, items, notes, payment_status, payment_method, paid_from_bank_id,
        employee_id, receipt_document_id, source, ocr_suggested, verified_at, verified_by, approval_status, created_by, expense_claim_id, card_id)
      values (c.company_id, coalesce(p_project, c.project_id), c.spent_on, coalesce(p_category, c.category), p_supplier, c.supplier_name, c.supplier_trn, c.description,
        c.amount, c.vat_amount, case when c.amount > 0 then round(c.vat_amount / c.amount * 100, 2) end, c.reference, c.quantity, c.items,
        left(concat_ws(E'\n', 'Employee expense claim, approved' || coalesce(': ' || note, '') || '.', c.notes), 2000),
        'paid', case c.paid_with when 'bank_transfer' then 'bank_transfer' when 'card' then 'card' when 'cash' then 'cash' else 'other' end, p_bank,
        c.employee_id, c.receipt_document_id, c.source, c.ocr_suggested, now(), auth.uid(), 'approved', c.submitted_by, c.id, c.card_id)
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
