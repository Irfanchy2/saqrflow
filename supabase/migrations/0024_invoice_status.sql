-- 0024 invoice document status and payment status, shown separately. Additive only: one new nullable column, two
-- functions and one view. No existing row, column, status value or policy is changed.
--   Document status: Draft · Sent · Viewed · Cancelled   (where the document is)
--   Payment status:  Unpaid · Partially paid · Paid · Overdue (+ Credited when credit notes settle it without payment)
-- invoices.status keeps its existing values, so reports, reminders and filters that use it are unaffected.

-- When the customer first opened the document (secure-link PDF download, or a WhatsApp "read" receipt).
alter table invoices add column if not exists viewed_at timestamptz;

-- "Today" in the company's own time zone (an invoice is overdue from the day after its due date, Dubai time).
create or replace function company_today() returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from companies where id = current_company_id()), 'Asia/Dubai'))::date
$$;
revoke execute on function company_today() from public, anon;
grant execute on function company_today() to authenticated, service_role;

-- Payment status from recorded money only (same rules as lib/sales/status.ts payState): never "paid" without a payment.
create or replace function invoice_payment_status(p_status text, p_total numeric, p_paid numeric, p_credited numeric, p_due date, p_today date)
returns text language sql immutable set search_path = public as $$
  select case
    when p_status in ('draft', 'cancelled') then null
    when round(p_total - p_credited, 2) <= 0 then case when round(p_paid, 2) > 0 then 'paid' else 'credited' end
    when round(p_paid, 2) >= round(p_total - p_credited, 2) then 'paid'
    when p_due is not null and p_due < p_today then 'overdue'
    when round(p_paid, 2) > 0 then 'partially_paid'
    else 'unpaid' end
$$;
revoke execute on function invoice_payment_status(text, numeric, numeric, numeric, date, date) from public, anon;
grant execute on function invoice_payment_status(text, numeric, numeric, numeric, date, date) to authenticated, service_role;

-- Sales document list with the money and both statuses (security_invoker: the reader's own row-level security applies,
-- exactly as on invoices / payments; soft-deleted documents stay hidden).
create or replace view invoice_list with (security_invoker = true) as
  select i.id, i.company_id, i.doc_type, i.number, i.status, i.customer_id, i.customer_name, i.subject, i.site, i.lpo_ref, i.project_id,
         i.issue_date, i.due_date, i.valid_until, i.total, i.vat_amount, i.viewed_at, i.created_at,
         coalesce(p.paid, 0)::numeric(14,2) as paid, coalesce(cn.credited, 0)::numeric(14,2) as credited,
         greatest(i.total - coalesce(p.paid, 0) - coalesce(cn.credited, 0), 0)::numeric(14,2) as balance,
         case when i.doc_type not in ('invoice', 'credit_note') then null
              when i.status = 'draft' then 'draft' when i.status = 'cancelled' then 'cancelled'
              when i.viewed_at is not null or i.status = 'viewed' then 'viewed' else 'sent' end as doc_status,
         case when i.doc_type = 'invoice' then invoice_payment_status(i.status, i.total, coalesce(p.paid, 0), coalesce(cn.credited, 0), i.due_date, company_today()) end as payment_status
  from invoices i
  left join lateral (select sum(y.amount) as paid from payments y where y.invoice_id = i.id) p on true
  left join lateral (select sum(c.total) as credited from invoices c
                     where c.source_invoice_id = i.id and c.doc_type = 'credit_note' and c.status not in ('draft', 'cancelled') and c.deleted_at is null) cn on true
  where i.deleted_at is null;
revoke all on invoice_list from public, anon;
grant select on invoice_list to authenticated, service_role;
