-- 0022 performance (additive only: indexes, an equivalent view definition, the same RLS rules evaluated once per query).
-- No table, column or row is changed or removed.

-- 1. Indexes for lookups the record pages make (all "if not exists"; tables are small, so plain CREATE INDEX is quick).
-- activity panel on every record page: audit rows for one record, newest first
create index if not exists audit_logs_record_idx on audit_logs (company_id, record_id, created_at desc);
-- customer / project / invoice pages
create index if not exists cheques_customer_idx on cheques (customer_id) where customer_id is not null;
create index if not exists cheques_invoice_idx on cheques (invoice_id) where invoice_id is not null;
create index if not exists cheques_project_idx on cheques (project_id) where project_id is not null;
create index if not exists service_tickets_customer_idx on service_tickets (customer_id) where customer_id is not null;
create index if not exists service_tickets_project_idx on service_tickets (project_id) where project_id is not null;
create index if not exists warranties_project_idx on warranties (project_id) where project_id is not null;
create index if not exists leads_customer_idx on leads (customer_id) where customer_id is not null;
create index if not exists leads_project_idx on leads (project_id) where project_id is not null;
create index if not exists share_links_customer_idx on share_links (customer_id) where customer_id is not null;
create index if not exists share_links_invoice_idx on share_links (invoice_id) where invoice_id is not null;
create index if not exists share_links_employee_idx on share_links (employee_id) where employee_id is not null;
create index if not exists share_links_supplier_idx on share_links (supplier_id) where supplier_id is not null;
-- staff links (employee profile, project team, work-order crews, expenses by employee)
create index if not exists work_order_members_employee_idx on work_order_members (employee_id);
create index if not exists tasks_employee_idx on tasks (employee_id) where employee_id is not null;
create index if not exists project_expenses_employee_idx on project_expenses (employee_id) where employee_id is not null;
create index if not exists invoices_customer_idx on invoices (customer_id) where customer_id is not null;
create index if not exists invoices_project_idx on invoices (project_id) where project_id is not null;
-- notification bell on every page: the latest notifications of the signed-in user
create index if not exists in_app_notifications_user_recent_idx on in_app_notifications (user_id, created_at desc);

-- 2. invoice_balances: same columns and results; the paid and credited sums are now computed per invoice through the
-- payments(invoice_id) and invoices(source_invoice_id) indexes, instead of aggregating every payment first.
create or replace view invoice_balances with (security_invoker = true) as
  select i.id, i.company_id, i.total, coalesce(p.paid, 0)::numeric(14,2) as paid,
         (i.total - coalesce(p.paid, 0) - coalesce(cn.credited, 0))::numeric(14,2) as balance,
         coalesce(cn.credited, 0)::numeric(14,2) as credited
  from invoices i
  left join lateral (select sum(y.amount) as paid from payments y where y.invoice_id = i.id) p on true
  left join lateral (select sum(c.total) as credited from invoices c
                     where c.source_invoice_id = i.id and c.doc_type = 'credit_note' and c.status not in ('draft','cancelled') and c.deleted_at is null) cn on true;

-- 3. RLS: identical rules; auth.uid() is wrapped in a sub-select so Postgres evaluates it once per query, not once per row.
alter policy ai_processing_logs_insert on ai_processing_logs with check (((company_id = current_company_id()) AND (created_by = (select auth.uid())) AND (has_permission('documents.upload'::text) OR has_permission('settings.manage'::text))));
alter policy ar_select on approval_requests using (((company_id = current_company_id()) AND ((requested_by = (select auth.uid())) OR has_permission('approvals.decide'::text) OR has_permission('sales.approve'::text) OR has_permission('finance.view'::text))));
alter policy ar_update on approval_requests using (((company_id = current_company_id()) AND (has_permission('approvals.decide'::text) OR has_permission('sales.approve'::text) OR (requested_by = (select auth.uid()))))) with check ((company_id = current_company_id()));
alter policy dal_insert on document_access_logs with check (((company_id = current_company_id()) AND (user_id = (select auth.uid())) AND (EXISTS ( SELECT 1 FROM documents d WHERE (d.id = document_access_logs.document_id)))));
alter policy inbox_insert on document_inbox with check (((company_id = current_company_id()) AND (uploaded_by = (select auth.uid())) AND has_permission('documents.upload'::text)));
alter policy inbox_select on document_inbox using (((company_id = current_company_id()) AND ((uploaded_by = (select auth.uid())) OR has_permission('employees.view_sensitive'::text))));
alter policy inbox_update on document_inbox using (((company_id = current_company_id()) AND has_permission('documents.upload'::text) AND ((uploaded_by = (select auth.uid())) OR has_permission('employees.view_sensitive'::text)))) with check ((company_id = current_company_id()));
alter policy emp_select on employees using (((company_id = current_company_id()) AND (has_permission('employees.view'::text) OR (user_id = (select auth.uid())))));
alter policy ian_select on in_app_notifications using ((user_id = (select auth.uid())));
alter policy ian_update on in_app_notifications using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy la_insert on lead_activities with check (((company_id = current_company_id()) AND has_permission('records.edit'::text) AND (user_id = (select auth.uid())) AND (EXISTS ( SELECT 1 FROM leads l WHERE (l.id = lead_activities.lead_id)))));
alter policy le_select on login_events using (((user_id = (select auth.uid())) OR ((company_id = current_company_id()) AND has_permission('users.manage'::text))));
alter policy ocr_logs_insert on ocr_logs with check (((company_id = current_company_id()) AND (created_by = (select auth.uid())) AND (has_permission('documents.upload'::text) OR has_permission('settings.manage'::text))));
alter policy profiles_update on profiles using (((company_id = current_company_id()) AND ((id = (select auth.uid())) OR has_permission('users.manage'::text)))) with check ((company_id = current_company_id()));
alter policy sde_insert on sales_doc_events with check (((company_id = current_company_id()) AND has_permission('finance.view'::text) AND (user_id = (select auth.uid())) AND (EXISTS ( SELECT 1 FROM invoices i WHERE (i.id = sales_doc_events.invoice_id)))));
alter policy sv_delete on saved_views using (((company_id = current_company_id()) AND ((user_id = (select auth.uid())) OR (shared AND has_permission('settings.manage'::text)))));
alter policy sv_insert on saved_views with check (((company_id = current_company_id()) AND (user_id = (select auth.uid())) AND ((NOT shared) OR has_permission('records.edit'::text))));
alter policy sv_select on saved_views using (((company_id = current_company_id()) AND ((user_id = (select auth.uid())) OR shared)));
alter policy st_select on service_tickets using (((company_id = current_company_id()) AND (has_permission('documents.view'::text) OR (assigned_to = (select auth.uid())))));
alter policy st_update on service_tickets using (((company_id = current_company_id()) AND (has_permission('records.edit'::text) OR (assigned_to = (select auth.uid()))))) with check ((company_id = current_company_id()));
alter policy tasks_mine on tasks using (((company_id = current_company_id()) AND (owner_id = (select auth.uid()))));
alter policy tasks_mine_update on tasks using (((company_id = current_company_id()) AND (owner_id = (select auth.uid())))) with check (((company_id = current_company_id()) AND (owner_id = (select auth.uid()))));
alter policy te_insert on ticket_events with check (((company_id = current_company_id()) AND (user_id = (select auth.uid())) AND (EXISTS ( SELECT 1 FROM service_tickets t WHERE (t.id = ticket_events.ticket_id)))));
alter policy up_own on user_preferences using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy us_select on user_sessions using (((user_id = (select auth.uid())) OR ((company_id = current_company_id()) AND has_permission('users.manage'::text))));
