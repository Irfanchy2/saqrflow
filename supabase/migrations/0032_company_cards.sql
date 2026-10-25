-- 0032: Company cards for card payments on employee expenses.
-- Additive only: a new table, two nullable columns, policies, triggers and an updated decide_expense_claim() that also
-- copies the card. No existing row is changed.
--
--  • Settings → Company cards: the cards employees may pay with ("Credit card", last 4 digits 9865). Only the last four
--    digits are ever stored, never a full card number.
--  • An employee who paid by card picks which one; it is required whenever the company has at least one active card.
--  • The card stays on the claim and goes with it onto the company expense when approved.

create table if not exists company_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 60),
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  kind text not null default 'credit' check (kind in ('credit','debit','prepaid')),
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists company_cards_company_idx on company_cards(company_id, active);
alter table company_cards enable row level security;
drop policy if exists cc_select on company_cards;
create policy cc_select on company_cards for select to authenticated using (company_id = current_company_id());
drop policy if exists cc_insert on company_cards;
create policy cc_insert on company_cards for insert to authenticated with check (company_id = current_company_id() and has_permission('settings.manage'));
drop policy if exists cc_update on company_cards;
create policy cc_update on company_cards for update to authenticated using (company_id = current_company_id() and has_permission('settings.manage'))
  with check (company_id = current_company_id());
-- no delete policy: a card used on expenses is switched off, never removed
drop trigger if exists audit_company_cards on company_cards;
create trigger audit_company_cards after insert or update or delete on company_cards for each row execute function audit_row();

alter table expense_claims add column if not exists card_id uuid references company_cards(id) on delete set null;
alter table project_expenses add column if not exists card_id uuid references company_cards(id) on delete set null;

-- The card must be this company's, only goes with a card payment, and is required for one when the company has cards.
create or replace function expense_claims_card_check() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.paid_with is distinct from 'card' then new.card_id := null; return new; end if;
  if tg_op = 'UPDATE' and new.paid_with is not distinct from old.paid_with and new.card_id is not distinct from old.card_id then return new; end if;
  if new.card_id is not null then
    if not exists (select 1 from company_cards k where k.id = new.card_id and k.company_id = new.company_id and k.active) then
      raise exception 'Choose one of your company''s cards.';
    end if;
  elsif exists (select 1 from company_cards k where k.company_id = new.company_id and k.active) then
    raise exception 'Choose which card you paid with.';
  end if;
  return new;
end $$;
revoke execute on function expense_claims_card_check() from public, anon, authenticated;
drop trigger if exists expense_claims_card_t on expense_claims;
create trigger expense_claims_card_t before insert or update on expense_claims for each row execute function expense_claims_card_check();

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
        employee_id, receipt_document_id, source, ocr_suggested, verified_at, verified_by, approval_status, created_by, expense_claim_id, card_id)
      values (c.company_id, p_project, c.spent_on, coalesce(p_category, c.category), p_supplier, c.supplier_name, c.supplier_trn, c.description,
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
