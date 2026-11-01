-- 0038: supporting attachments for Employee Petty Cash (Issue petty cash, employee reports of money received / returned).
-- Additive and safe to re-run: no existing data is changed.
--
-- A petty cash attachment is a vault document with owner_type 'petty_cash' and owner_id = the employee whose wallet it
-- belongs to. Who may open it: petty cash managers, finance, and that employee (only their own).

alter table documents drop constraint if exists documents_owner_type_check;
alter table documents add constraint documents_owner_type_check check (owner_type in
  ('company','employee','project','asset','cheque','vault','lead','site_visit','work_order','expense_claim','petty_cash'));

create or replace function can_view_document(otype text, oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case otype
    when 'employee' then has_permission('employees.view_sensitive') or (oid is not null and is_own_employee(oid))
    when 'cheque'   then has_permission('finance.view')
    when 'expense_claim' then has_permission('finance.view') or has_permission('expenses.approve')
      or exists (select 1 from expense_claims c where c.id = oid and c.employee_id = my_employee_id())
    when 'petty_cash' then has_permission('finance.view') or petty_can_manage() or (oid is not null and oid = my_employee_id())
    else has_permission('documents.view') end
$$;

-- an attachment given when issuing petty cash must be this company's, filed for this employee's petty cash
create or replace function petty_issue(p_employee uuid, p_amount numeric, p_date date, p_method text, p_bank uuid, p_project uuid,
  p_purpose text, p_reference text, p_notes text, p_document uuid, p_key uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare co uuid := petty_check(p_employee, p_bank, p_project);
begin
  if p_key is null then raise exception 'Missing request key.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'Enter an amount greater than zero.'; end if;
  if p_date is null or p_date > current_date + 1 then raise exception 'Enter the date the money was handed over.'; end if;
  if nullif(btrim(coalesce(p_purpose, '')), '') is null then raise exception 'Give the purpose of the petty cash.'; end if;
  if p_document is not null and not exists (select 1 from documents d where d.id = p_document and d.company_id = co
      and d.owner_type = 'petty_cash' and d.owner_id = p_employee and d.deleted_at is null) then
    raise exception 'Attachment not found.';
  end if;
  perform petty_lock(p_employee);
  return petty_post(co, p_employee, 'received', p_amount, p_date, btrim(p_purpose), 'issue:' || p_key, p_method, p_bank, p_project, null, null, p_document, p_reference, p_notes);
end $$;
revoke all on function petty_issue(uuid, numeric, date, text, uuid, uuid, text, text, text, uuid, uuid) from public, anon;
grant execute on function petty_issue(uuid, numeric, date, text, uuid, uuid, text, text, text, uuid, uuid) to authenticated;

-- an employee may attach only a petty cash document filed for their own wallet
drop policy if exists pcr_insert on petty_cash_requests;
create policy pcr_insert on petty_cash_requests for insert to authenticated with check (
  company_id = current_company_id() and employee_id = my_employee_id() and status = 'pending'
  and entry_id is null and not linked and decided_by is null and decided_at is null and decision_note is null
  and (submitted_by is null or submitted_by = auth.uid())
  and (project_id is null or exists (select 1 from projects p where p.id = project_id and p.company_id = current_company_id()))
  and (document_id is null or exists (select 1 from documents d where d.id = document_id and d.company_id = current_company_id()
       and d.owner_type = 'petty_cash' and d.owner_id = employee_id)));
drop policy if exists pcr_update on petty_cash_requests;
create policy pcr_update on petty_cash_requests for update to authenticated
  using (company_id = current_company_id() and employee_id = my_employee_id() and status in ('pending','correction_requested'))
  with check (company_id = current_company_id() and employee_id = my_employee_id() and status in ('pending','withdrawn')
    and (project_id is null or exists (select 1 from projects p where p.id = project_id and p.company_id = current_company_id()))
    and (document_id is null or exists (select 1 from documents d where d.id = document_id and d.company_id = current_company_id()
         and d.owner_type = 'petty_cash' and d.owner_id = employee_id)));
