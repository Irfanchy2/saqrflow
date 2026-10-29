-- 0035: Free WhatsApp sharing of payslips, salary receipts and sales documents. Additive only; no existing row is changed.
--
--  • employees.whatsapp: the employee's WhatsApp number (international, +971…). Optional; when empty the contact number is
--    used. Saved only when someone allowed to edit the employee chooses to save it.
--  • Staff with salary access (owner, HR manager, accountant) can read employee records, so the salary pages show names for
--    everyone who may pay salary. Before, an accountant had salary access but saw no employees.
--  • document_shares: a record each time someone opens WhatsApp (or the phone's share sheet) for a document. It records the
--    intent only ("opened WhatsApp"), never that a message was sent or delivered, and keeps only the last digits of the number.

alter table employees add column if not exists whatsapp text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_whatsapp_e164') then
    alter table employees add constraint employees_whatsapp_e164 check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end $$;

drop policy if exists emp_select_salary on employees;
create policy emp_select_salary on employees for select to authenticated
  using (company_id = current_company_id() and has_permission('salary.view'));

create table if not exists document_shares (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  doc_kind text not null check (doc_kind in ('payslip','salary_receipt','quotation','invoice','delivery_note','payment_reminder')),
  record_id uuid not null,
  party_type text not null check (party_type in ('employee','customer')),
  party_id uuid,
  method text not null check (method in ('native_share','whatsapp_link','download')),
  phone_last4 text check (phone_last4 is null or phone_last4 ~ '^[0-9]{1,4}$'),
  user_id uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists document_shares_record_idx on document_shares(company_id, doc_kind, record_id, created_at desc);

-- salary documents need salary access; sales documents need finance access. Nobody edits or deletes the log.
create or replace function share_kind_allowed(kind text) returns boolean language sql stable security definer set search_path = public as $$
  select case when kind in ('payslip','salary_receipt') then has_permission('salary.view') else has_permission('finance.view') end
$$;
revoke all on function share_kind_allowed(text) from public, anon;
grant execute on function share_kind_allowed(text) to authenticated;

alter table document_shares enable row level security;
drop policy if exists ds_select on document_shares;
create policy ds_select on document_shares for select to authenticated using (company_id = current_company_id() and share_kind_allowed(doc_kind));
drop policy if exists ds_insert on document_shares;
create policy ds_insert on document_shares for insert to authenticated
  with check (company_id = current_company_id() and user_id = auth.uid() and share_kind_allowed(doc_kind));
revoke all on document_shares from anon;
revoke update, delete on document_shares from authenticated;
