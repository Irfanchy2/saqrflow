-- 0036: free WhatsApp sharing for more documents. Additive and safe to re-run: no data is changed or removed.
--   salary_statement   (employee, salary access)
--   customer_receipt   (customer, finance access)
--   customer_statement (customer, finance access)
--   employee_document  (employee, document access + sensitive employee data)
-- The share log (document_shares) only records that WhatsApp was opened for a document: intent, never "sent".

-- 1. the share log accepts the new document types (a superset of the old list, so every existing row still passes)
alter table document_shares drop constraint if exists document_shares_doc_kind_check;
alter table document_shares add constraint document_shares_doc_kind_check check (doc_kind in (
  'payslip','salary_receipt','salary_statement','quotation','invoice','delivery_note','payment_reminder',
  'customer_receipt','customer_statement','employee_document'));

-- 2. who may read and write share log rows for each type (same rule as the app: lib/whatsapp/share.ts sharePerms)
create or replace function share_kind_allowed(kind text) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when kind in ('payslip','salary_receipt','salary_statement') then has_permission('salary.view')
    when kind = 'employee_document' then has_permission('documents.view') and has_permission('employees.view_sensitive')
    else has_permission('finance.view') end
$$;
revoke all on function share_kind_allowed(text) from public, anon;
grant execute on function share_kind_allowed(text) to authenticated;
