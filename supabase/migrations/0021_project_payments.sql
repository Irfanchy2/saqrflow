-- 0021: project payments (customer advances) and applying them to quotations, invoices and delivery notes.
-- An advance is an ordinary payment received on account (payments.invoice_id null) tagged with its project, so it already
-- appears in the customer ledger / statement, receipts and the payment log. Recording one never creates a tax invoice or VAT.
-- Documents carry advance_applied (the amount shown as "Less: advance received"). When a tax invoice is issued, that amount is
-- linked to the invoice from the project's unapplied advances (oldest first); an advance used only in part is split, so the
-- invoice balance, status, receivables and ledger keep working from payments exactly as before.
-- Additive only. The advance on a document is stored by the save action (app/actions/sales.ts) after save_sales_doc.

alter table payments add column if not exists project_id uuid references projects(id) on delete set null;
alter table payments add column if not exists split_from uuid references payments(id) on delete set null;   -- the part of an advance applied to an invoice
create index if not exists payments_project_idx on payments(company_id, project_id) where project_id is not null;

alter table invoices add column if not exists advance_applied numeric(14,2) not null default 0 check (advance_applied >= 0);

-- a project payment belongs to the project's company; the customer defaults to the project's customer
create or replace function payments_project_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  if new.project_id is null then return new; end if;
  select company_id, customer_id into pr from projects where id = new.project_id;
  if pr is null or pr.company_id <> new.company_id then raise exception 'project belongs to another company'; end if;
  new.customer_id := coalesce(new.customer_id, pr.customer_id);
  return new;
end $$;
create trigger payments_project_guard_t before insert or update on payments for each row execute function payments_project_guard();

-- unapplied advances of a project (received on account, not yet linked to an invoice)
create or replace function project_unapplied(p_project uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from payments
  where project_id = p_project and invoice_id is null and company_id = current_company_id() and has_permission('finance.view')
$$;
revoke execute on function project_unapplied(uuid) from public, anon;
grant execute on function project_unapplied(uuid) to authenticated;

-- links up to p_amount of the project's unapplied advances to an issued tax invoice (oldest first, splitting the last one)
create or replace function apply_project_advance(p_invoice uuid, p_amount numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare inv record; p record; left_ numeric; avail numeric; owed numeric; nid uuid;
begin
  if p_amount is null or p_amount <= 0 then return 0; end if;
  select * into inv from invoices where id = p_invoice for update;
  if inv is null or inv.company_id <> current_company_id() then raise exception 'invoice not found'; end if;
  if not (has_permission('records.edit') and has_permission('finance.view')) then raise exception 'permission denied'; end if;
  if inv.doc_type <> 'invoice' or inv.status in ('draft','cancelled') then raise exception 'issue the invoice before applying an advance'; end if;
  if inv.project_id is null then raise exception 'the invoice is not linked to a project'; end if;
  select coalesce(sum(amount), 0) into avail from payments where project_id = inv.project_id and invoice_id is null and company_id = inv.company_id;
  owed := inv.total - invoice_credits(p_invoice) - coalesce((select sum(amount) from payments where invoice_id = p_invoice), 0);
  if p_amount > avail + 0.005 then raise exception 'advance exceeds the unapplied project payments (available %)', round(avail, 2); end if;
  if p_amount > owed + 0.005 then raise exception 'advance exceeds the invoice balance (balance %)', round(owed, 2); end if;
  left_ := round(p_amount, 2);
  for p in select * from payments where project_id = inv.project_id and invoice_id is null and company_id = inv.company_id order by paid_on, created_at, id for update loop
    exit when left_ <= 0;
    if p.amount <= left_ + 0.004 then
      update payments set invoice_id = p_invoice where id = p.id;
      left_ := left_ - p.amount;
    else
      update payments set amount = p.amount - left_ where id = p.id;
      insert into payments(company_id, invoice_id, customer_id, project_id, amount, paid_on, method, reference, bank_name, notes, created_by, split_from)
        values (p.company_id, p_invoice, p.customer_id, p.project_id, left_, p.paid_on, p.method, p.reference, p.bank_name, p.notes, p.created_by, p.id)
        returning id into nid;
      -- the applied part of an advance is not new money: its "payment received" event is closed, so no alert or webhook is sent
      update app_events set claimed_at = now(), processed_at = now() where entity_id = nid and processed_at is null;
      left_ := 0;
    end if;
  end loop;
  return round(p_amount, 2);
end $$;
revoke execute on function apply_project_advance(uuid, numeric) from public, anon;
grant execute on function apply_project_advance(uuid, numeric) to authenticated;

-- issuing a tax invoice applies the advance chosen while drafting it
create or replace function invoice_issue_advance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.doc_type = 'invoice' and old.status = 'draft' and new.status not in ('draft','cancelled') and new.advance_applied > 0 then
    perform apply_project_advance(new.id, new.advance_applied);
  end if;
  return null;
end $$;
create trigger invoice_issue_advance_t after update of status on invoices for each row execute function invoice_issue_advance();
