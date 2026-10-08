-- 0013: Vehicles & Assets completion (statuses, VIN / mileage / condition, assignment history, asset expenses)
-- and server-side report aggregation (Reports & Analytics). Additive only: existing rows keep their values.
-- Reuses existing structures: assets (vehicles + equipment), documents (owner_type 'asset' + document_relationships),
-- asset_maintenance, project_expenses and the reminder engine (reminder_sources). No duplicate tables.

-- ───────────── assets: statuses + fields ─────────────
alter table assets drop constraint if exists assets_status_check;
alter table assets add constraint assets_status_check check (status in
  ('active','assigned','available','in_maintenance','in_repair','out_of_service','retired','sold','disposed'));
alter table assets
  add column if not exists vin text check (length(vin) <= 40),
  add column if not exists current_mileage int check (current_mileage is null or current_mileage between 0 and 5000000),
  add column if not exists mileage_updated_on date,
  add column if not exists service_interval_km int check (service_interval_km is null or service_interval_km between 100 and 200000),
  add column if not exists next_service_km int check (next_service_km is null or next_service_km >= 0),
  add column if not exists condition text check (condition in ('new','good','fair','poor','damaged')),
  add column if not exists client_token uuid;   -- idempotency: one click on Save → one vehicle
create unique index if not exists assets_client_token_uidx on assets(company_id, client_token) where client_token is not null;
create index if not exists assets_company_status_idx on assets(company_id, status) where archived_at is null and deleted_at is null;

-- an odometer reading in a maintenance record moves the vehicle's mileage forward (never backwards)
create or replace function asset_maintenance_mileage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.odometer is not null then
    update assets set current_mileage = new.odometer, mileage_updated_on = new.performed_on,
      next_service_km = case when service_interval_km is not null and new.kind in ('service','repair') then new.odometer + service_interval_km else next_service_km end
    where id = new.asset_id and company_id = new.company_id and (current_mileage is null or current_mileage <= new.odometer);
  end if;
  return null;
end $$;
drop trigger if exists asset_maintenance_mileage_t on asset_maintenance;
create trigger asset_maintenance_mileage_t after insert on asset_maintenance for each row execute function asset_maintenance_mileage();
revoke execute on function asset_maintenance_mileage() from public, anon, authenticated;

-- ───────────── assignment history ─────────────
create table if not exists asset_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  location text check (length(location) <= 200),
  assigned_on date not null default current_date,
  returned_on date,
  note text check (length(note) <= 500),
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (returned_on is null or returned_on >= assigned_on)
);
create index if not exists asset_assignments_asset_idx on asset_assignments(asset_id, assigned_on desc);
create index if not exists asset_assignments_employee_idx on asset_assignments(employee_id) where employee_id is not null;
create unique index if not exists asset_assignments_open_uidx on asset_assignments(asset_id) where returned_on is null;   -- one current assignment

-- every change of assets.assigned_to is recorded: the open assignment is closed and a new one opened (same transaction)
create or replace function asset_assignment_track() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone coalesce((select timezone from companies where id = new.company_id), 'Asia/Dubai'))::date;
begin
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return null; end if;
  update asset_assignments set returned_on = greatest(d, assigned_on) where asset_id = new.id and returned_on is null;
  if new.assigned_to is not null then
    insert into asset_assignments(company_id, asset_id, employee_id, location, assigned_on, created_by)
    values (new.company_id, new.id, new.assigned_to, new.location, d, auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists asset_assignment_track_t on assets;
create trigger asset_assignment_track_t after insert or update of assigned_to on assets for each row execute function asset_assignment_track();
revoke execute on function asset_assignment_track() from public, anon, authenticated;

-- existing assignments become the first history row (dated the day the asset was created)
insert into asset_assignments(company_id, asset_id, employee_id, location, assigned_on)
select a.company_id, a.id, a.assigned_to, a.location, a.created_at::date from assets a
where a.assigned_to is not null and not exists (select 1 from asset_assignments x where x.asset_id = a.id);

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'asset_assignments') then perform apply_standard_rls('asset_assignments', 'documents.view', 'records.edit'); end if;
end $$;
drop trigger if exists audit_asset_assignments on asset_assignments;
create trigger audit_asset_assignments after insert or update or delete on asset_assignments for each row execute function audit_row();

-- ───────────── expenses can belong to a vehicle / asset (fuel, salik, repairs, parts) ─────────────
alter table project_expenses add column if not exists asset_id uuid references assets(id) on delete set null;
create index if not exists project_expenses_asset_idx on project_expenses(asset_id, spent_on desc) where asset_id is not null;

-- ───────────── reminders: mileage-based service joins the existing engine ─────────────
-- (date-based Mulkiya / insurance / inspection / warranty / service reminders already flow through reminder_sources)

-- ───────────── reporting indexes ─────────────
create index if not exists payments_company_paid_idx on payments(company_id, paid_on);
create index if not exists asset_maintenance_company_idx on asset_maintenance(company_id, performed_on);

-- ───────────── Reports & Analytics: one aggregation call per page view ─────────────
-- SECURITY INVOKER: every row is read through the caller's RLS, so a section the user may not see comes back empty / zero.
-- Finance sections are additionally skipped (null) without finance.view so the page never shows a misleading 0.
-- p_today is the company's local date (Asia/Dubai) computed by the app: no UTC shift on date-only fields.
create or replace function report_summary(p_from date, p_to date, p_today date) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  cid uuid := current_company_id(); fin boolean := has_permission('finance.view');
  r jsonb := '{}'::jsonb; m_from date := (date_trunc('month', p_to) - interval '11 months')::date;
begin
  if cid is null then raise exception 'insufficient privilege'; end if;
  if p_from > p_to then raise exception 'from date is after to date'; end if;

  if fin then
    -- sales in period (issued tax invoices) + money received + credit notes
    r := r || jsonb_build_object('sales', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0), 'vat', coalesce(sum(vat_amount), 0),
        'net', coalesce(sum(total - vat_amount), 0), 'avg', coalesce(round(avg(total), 2), 0))
      from invoices where company_id = cid and doc_type = 'invoice' and status not in ('draft','cancelled') and deleted_at is null
        and issue_date between p_from and p_to));
    r := r || jsonb_build_object('received', (select coalesce(sum(amount), 0) from payments where company_id = cid and paid_on between p_from and p_to),
      'credited', (select coalesce(sum(total), 0) from invoices where company_id = cid and doc_type = 'credit_note' and status not in ('draft','cancelled') and deleted_at is null and issue_date between p_from and p_to));

    -- 12-month series ending with the selected period: invoiced (ex VAT) vs received
    r := r || jsonb_build_object('monthly', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'net', coalesce(i.net, 0), 'total', coalesce(i.total, 0), 'count', coalesce(i.n, 0), 'received', coalesce(p.amt, 0)) order by m), '[]'::jsonb)
      from generate_series(m_from, date_trunc('month', p_to)::date, interval '1 month') m
      left join (select date_trunc('month', issue_date) mo, sum(total - vat_amount) net, sum(total) total, count(*) n from invoices
                 where company_id = cid and doc_type = 'invoice' and status not in ('draft','cancelled') and deleted_at is null and issue_date >= m_from and issue_date <= p_to group by 1) i on i.mo = m
      left join (select date_trunc('month', paid_on) mo, sum(amount) amt from payments where company_id = cid and paid_on >= m_from and paid_on <= p_to group by 1) p on p.mo = m));

    -- quotations issued in period
    r := r || jsonb_build_object('quotations', (
      select jsonb_build_object('count', count(*), 'value', coalesce(sum(total), 0),
        'by_status', coalesce((select jsonb_object_agg(status, jsonb_build_object('n', n, 'v', v)) from (select status, count(*) n, sum(total) v from invoices
            where company_id = cid and doc_type = 'quotation' and deleted_at is null and issue_date between p_from and p_to group by status) s), '{}'::jsonb),
        'won', count(*) filter (where status in ('accepted','converted')), 'won_value', coalesce(sum(total) filter (where status in ('accepted','converted')), 0),
        'decided', count(*) filter (where status in ('accepted','converted','rejected','expired')),
        'avg', coalesce(round(avg(total), 2), 0))
      from invoices where company_id = cid and doc_type = 'quotation' and deleted_at is null and issue_date between p_from and p_to));
    r := r || jsonb_build_object('quote_monthly', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'count', coalesce(q.n, 0), 'value', coalesce(q.v, 0), 'won', coalesce(q.w, 0)) order by m), '[]'::jsonb)
      from generate_series(m_from, date_trunc('month', p_to)::date, interval '1 month') m
      left join (select date_trunc('month', issue_date) mo, count(*) n, sum(total) v, count(*) filter (where status in ('accepted','converted')) w from invoices
                 where company_id = cid and doc_type = 'quotation' and deleted_at is null and issue_date >= m_from and issue_date <= p_to group by 1) q on q.mo = m));

    -- customers: revenue in period + what they owe today; quotation conversion per customer
    r := r || jsonb_build_object('top_customers', (
      select coalesce(jsonb_agg(x order by (x->>'net')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('id', i.customer_id, 'name', coalesce(max(cu.name), max(i.customer_name), 'Unassigned'), 'net', sum(i.total - i.vat_amount), 'total', sum(i.total), 'count', count(*),
          'quotes', (select count(*) from invoices q where q.company_id = cid and q.doc_type = 'quotation' and q.deleted_at is null and q.customer_id = i.customer_id and q.issue_date between p_from and p_to),
          'quotes_won', (select count(*) from invoices q where q.company_id = cid and q.doc_type = 'quotation' and q.deleted_at is null and q.customer_id = i.customer_id and q.issue_date between p_from and p_to and q.status in ('accepted','converted'))) x
        from invoices i left join customers cu on cu.id = i.customer_id
        where i.company_id = cid and i.doc_type = 'invoice' and i.status not in ('draft','cancelled') and i.deleted_at is null and i.issue_date between p_from and p_to
        group by i.customer_id order by sum(i.total - i.vat_amount) desc limit 10) t));
    r := r || jsonb_build_object('by_project', (
      select coalesce(jsonb_agg(x order by (x->>'net')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code, 'net', sum(i.total - i.vat_amount), 'count', count(*)) x
        from invoices i join projects p on p.id = i.project_id
        where i.company_id = cid and i.doc_type = 'invoice' and i.status not in ('draft','cancelled') and i.deleted_at is null and i.issue_date between p_from and p_to
        group by p.id order by sum(i.total - i.vat_amount) desc limit 10) t));

    -- receivables today (all open invoices, not limited to the period), aged by days past due
    r := r || jsonb_build_object('receivables', (
      with open_inv as (
        select i.id, i.number, i.customer_id, coalesce(cu.name, i.customer_name, 'Unassigned') customer, i.issue_date, i.due_date, b.balance,
               greatest(0, p_today - coalesce(i.due_date, p_today)) late
        from invoices i join invoice_balances b on b.id = i.id left join customers cu on cu.id = i.customer_id
        where i.company_id = cid and i.doc_type = 'invoice' and i.deleted_at is null and i.status in ('sent','viewed','partially_paid','overdue') and b.balance > 0.004)
      select jsonb_build_object(
        'total', coalesce(sum(balance), 0), 'count', count(*),
        'current', coalesce(sum(balance) filter (where late = 0), 0), 'd30', coalesce(sum(balance) filter (where late between 1 and 30), 0),
        'd60', coalesce(sum(balance) filter (where late between 31 and 60), 0), 'd90', coalesce(sum(balance) filter (where late between 61 and 90), 0),
        'over90', coalesce(sum(balance) filter (where late > 90), 0), 'overdue_count', count(*) filter (where late > 0), 'overdue', coalesce(sum(balance) filter (where late > 0), 0),
        'rows', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'customer', customer, 'customer_id', customer_id, 'issue_date', issue_date, 'due_date', due_date, 'balance', balance, 'late', late) order by late desc, balance desc)
                          from (select * from open_inv order by late desc, balance desc limit 300) z), '[]'::jsonb))
      from open_inv));

    -- projects: value, billing, collections and recorded costs (profit only where cost data exists)
    r := r || jsonb_build_object('projects', (
      select jsonb_build_object(
        'active', count(*) filter (where status = 'active'), 'completed', count(*) filter (where status = 'completed'),
        'completed_in_period', count(*) filter (where status = 'completed' and updated_at::date between p_from and p_to),
        'rows', coalesce((select jsonb_agg(x order by (x->>'value')::numeric desc nulls last) from (
          select jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code, 'status', p.status, 'value', p.contract_value,
            'invoiced', coalesce((select sum(total - vat_amount) from invoices i where i.project_id = p.id and i.doc_type = 'invoice' and i.status not in ('draft','cancelled') and i.deleted_at is null), 0),
            'invoiced_total', coalesce((select sum(total) from invoices i where i.project_id = p.id and i.doc_type = 'invoice' and i.status not in ('draft','cancelled') and i.deleted_at is null), 0),
            'received', coalesce((select sum(pm.amount) from payments pm join invoices i on i.id = pm.invoice_id where i.project_id = p.id), 0),
            'expenses', coalesce((select sum(amount) from project_expenses e where e.project_id = p.id), 0),
            'expense_count', (select count(*) from project_expenses e where e.project_id = p.id),
            'labour_recorded', exists (select 1 from project_expenses e where e.project_id = p.id and e.category = 'labour'),
            'material_recorded', exists (select 1 from project_expenses e where e.project_id = p.id and e.category = 'material')) x
          from projects p where p.company_id = cid and p.deleted_at is null and p.status in ('planning','active','on_hold','completed')
          order by p.contract_value desc nulls last limit 50) t), '[]'::jsonb))
      from projects where company_id = cid and deleted_at is null));

    -- cheques (manual tracking: nothing is ever marked cleared here)
    r := r || jsonb_build_object('cheques', (
      select jsonb_build_object(
        'in_open', coalesce(sum(amount) filter (where direction = 'incoming' and status in ('received','scheduled','deposited','presented')), 0),
        'in_open_n', count(*) filter (where direction = 'incoming' and status in ('received','scheduled','deposited','presented')),
        'out_open', coalesce(sum(amount) filter (where direction = 'outgoing' and status in ('issued','scheduled','presented')), 0),
        'out_open_n', count(*) filter (where direction = 'outgoing' and status in ('issued','scheduled','presented')),
        'week_n', count(*) filter (where status in ('received','issued','scheduled') and cheque_date between p_today and p_today + 6),
        'week', coalesce(sum(case when direction = 'incoming' then amount else -amount end) filter (where status in ('received','issued','scheduled') and cheque_date between p_today and p_today + 6), 0),
        'month_n', count(*) filter (where status in ('received','issued','scheduled') and cheque_date between p_today and (date_trunc('month', p_today) + interval '1 month - 1 day')::date),
        'awaiting_n', count(*) filter (where status in ('deposited','presented')), 'awaiting', coalesce(sum(amount) filter (where status in ('deposited','presented')), 0),
        'cleared_n', count(*) filter (where status = 'cleared' and coalesce(cleared_at::date, cheque_date) between p_from and p_to),
        'cleared', coalesce(sum(amount) filter (where status = 'cleared' and coalesce(cleared_at::date, cheque_date) between p_from and p_to), 0),
        'returned_n', count(*) filter (where status = 'returned' and cheque_date between p_from and p_to),
        'returned', coalesce(sum(amount) filter (where status = 'returned' and cheque_date between p_from and p_to), 0),
        'overdue_n', count(*) filter (where status in ('received','issued','scheduled') and cheque_date < p_today))
      from cheques where company_id = cid));
  end if;

  -- document compliance (RLS decides which documents the caller can see: employee papers need HR rights)
  r := r || jsonb_build_object('documents', (
    select coalesce(jsonb_object_agg(grp, b), '{}'::jsonb) from (
      select grp, jsonb_build_object(
        'expired', count(*) filter (where expiry_date < p_today and status not in ('renewal_in_progress')),
        'd7', count(*) filter (where expiry_date between p_today and p_today + 7), 'd30', count(*) filter (where expiry_date between p_today and p_today + 30),
        'd60', count(*) filter (where expiry_date between p_today and p_today + 60), 'd90', count(*) filter (where expiry_date between p_today and p_today + 90),
        'renewal', count(*) filter (where status = 'renewal_in_progress'), 'total', count(*)) b
      from (select case when d.owner_type = 'employee' then 'employee' when d.owner_type = 'asset' then (case when a.kind = 'vehicle' then 'vehicle' else 'asset' end) else 'company' end grp, d.expiry_date, d.status
            from documents d left join assets a on d.owner_type = 'asset' and a.id = d.owner_id
            where d.company_id = cid and d.deleted_at is null and d.status not in ('cancelled','archived') and d.expiry_date is not null) z
      group by grp) g));
  r := r || jsonb_build_object('doc_monthly', (
    select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'company', coalesce(x.c, 0), 'employee', coalesce(x.e, 0), 'resource', coalesce(x.r, 0)) order by m), '[]'::jsonb)
    from generate_series(date_trunc('month', p_today)::date, (date_trunc('month', p_today) + interval '5 months')::date, interval '1 month') m
    left join (select date_trunc('month', expiry_date) mo, count(*) filter (where owner_type not in ('employee','asset')) c, count(*) filter (where owner_type = 'employee') e, count(*) filter (where owner_type = 'asset') r
               from documents where company_id = cid and deleted_at is null and status not in ('cancelled','archived') and expiry_date >= date_trunc('month', p_today) group by 1) x on x.mo = m));

  -- employee compliance: active staff, key permits expiring in 60 days, staff missing a required document
  r := r || jsonb_build_object('employees', (
    select jsonb_build_object(
      'active', (select count(*) from employees where company_id = cid and deleted_at is null and status in ('active','on_leave','probation')),
      'expiring', coalesce((select jsonb_object_agg(k, n) from (
        select k, count(*) n from (select case when c.name ilike '%visa%' then 'visa' when c.name ilike '%passport%' then 'passport' when c.name ilike '%emirates id%' then 'emirates_id'
              when c.name ilike '%work permit%' or c.name ilike '%labour card%' then 'work_permit' when c.name ilike '%insurance%' then 'insurance' end k
            from documents d join document_categories c on c.id = d.category_id join employees e on e.id = d.owner_id
            where d.company_id = cid and d.deleted_at is null and d.owner_type = 'employee' and e.deleted_at is null and e.status in ('active','on_leave','probation')
              and d.status not in ('cancelled','archived') and d.expiry_date <= p_today + 60) z where k is not null group by k) t), '{}'::jsonb),
      'missing_staff', (select count(*) from employees e where e.company_id = cid and e.deleted_at is null and e.status in ('active','on_leave','probation')
          and exists (select 1 from unnest(array['Passport','Emirates ID','Residence Visa','Work Permit','Labour Contract','Medical Insurance']) req(n)
                      where not exists (select 1 from documents d join document_categories c on c.id = d.category_id
                                        where d.owner_type = 'employee' and d.owner_id = e.id and d.deleted_at is null and c.name = req.n and d.status not in ('cancelled','archived')))))));

  -- vehicles & assets
  r := r || jsonb_build_object('resources', (
    select jsonb_build_object(
      'vehicles', count(*) filter (where kind = 'vehicle'),
      'vehicles_active', count(*) filter (where kind = 'vehicle' and status in ('active','assigned','available')),
      'reg_due', count(*) filter (where kind = 'vehicle' and registration_expiry <= p_today + 30),
      'ins_due', count(*) filter (where kind = 'vehicle' and insurance_expiry <= p_today + 30),
      'insp_due', count(*) filter (where kind = 'vehicle' and inspection_expiry <= p_today + 30),
      'v_service_due', count(*) filter (where kind = 'vehicle' and (next_service_date <= p_today + 30 or (next_service_km is not null and current_mileage >= next_service_km - 500))),
      'v_maint', count(*) filter (where kind = 'vehicle' and status in ('in_maintenance','in_repair')),
      'assets', count(*) filter (where kind <> 'vehicle'),
      'a_active', count(*) filter (where kind <> 'vehicle' and status = 'active'), 'a_assigned', count(*) filter (where kind <> 'vehicle' and (status = 'assigned' or (status = 'active' and assigned_to is not null))),
      'a_available', count(*) filter (where kind <> 'vehicle' and (status = 'available' or (status = 'active' and assigned_to is null))),
      'a_maint', count(*) filter (where kind <> 'vehicle' and status in ('in_maintenance','in_repair')),
      'a_out', count(*) filter (where kind <> 'vehicle' and status in ('out_of_service','retired')),
      'warranty_due', count(*) filter (where kind <> 'vehicle' and warranty_expiry between p_today and p_today + 60),
      'a_service_due', count(*) filter (where kind <> 'vehicle' and next_service_date <= p_today + 30),
      'v_cost', coalesce((select sum(m.cost) from asset_maintenance m join assets a2 on a2.id = m.asset_id where m.company_id = cid and a2.kind = 'vehicle' and m.performed_on between p_from and p_to), 0)
                + coalesce((select sum(e.amount) from project_expenses e join assets a3 on a3.id = e.asset_id where e.company_id = cid and a3.kind = 'vehicle' and e.spent_on between p_from and p_to), 0),
      'a_cost', coalesce((select sum(m.cost) from asset_maintenance m join assets a2 on a2.id = m.asset_id where m.company_id = cid and a2.kind <> 'vehicle' and m.performed_on between p_from and p_to), 0)
                + coalesce((select sum(e.amount) from project_expenses e join assets a3 on a3.id = e.asset_id where e.company_id = cid and a3.kind <> 'vehicle' and e.spent_on between p_from and p_to), 0))
    from assets where company_id = cid and archived_at is null and deleted_at is null and status not in ('sold','disposed')));

  return r;
end $$;
revoke execute on function report_summary(date, date, date) from public, anon;
grant execute on function report_summary(date, date, date) to authenticated;
