-- Permission model, tenant helpers, RLS, audit, integrity triggers.

-- ───────────── permission matrix (source of truth; mirrored in lib/permissions.ts) ─────────────
insert into role_permissions(role, permission)
select r::app_role, p from unnest(array['super_admin','company_owner']) r,
 unnest(array['documents.view','documents.upload','records.edit','salary.view','finance.view','cheques.manage',
  'reminders.create','data.export','records.delete','users.manage','employees.view',
  'employees.view_sensitive','audit.view','settings.manage']) p;
insert into role_permissions(role, permission) values
  ('hr_manager','documents.view'),('hr_manager','documents.upload'),('hr_manager','records.edit'),
  ('hr_manager','salary.view'),('hr_manager','employees.view'),('hr_manager','employees.view_sensitive'),
  ('hr_manager','reminders.create'),('hr_manager','data.export'),
  ('accountant','documents.view'),('accountant','records.edit'),('accountant','salary.view'),
  ('accountant','finance.view'),('accountant','cheques.manage'),('accountant','reminders.create'),
  ('accountant','data.export'),
  ('project_manager','documents.view'),('project_manager','documents.upload'),('project_manager','records.edit'),
  ('project_manager','employees.view'),('project_manager','reminders.create'),
  ('viewer','documents.view'),('viewer','employees.view');
-- 'employee' role: no company-wide permissions; sees only its own employee record/documents.

-- ───────────── helpers ─────────────
create or replace function current_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid() and is_active
$$;

create or replace function has_permission(perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p join role_permissions rp on rp.role = p.role
    where p.id = auth.uid() and p.is_active and rp.permission = perm)
$$;

create or replace function is_own_employee(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees e where e.id = emp and e.user_id = auth.uid() and e.company_id = current_company_id())
$$;

create or replace function can_view_document(otype text, oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case otype
    when 'employee' then has_permission('employees.view_sensitive') or (oid is not null and is_own_employee(oid))
    when 'cheque'   then has_permission('finance.view')
    else has_permission('documents.view') end
$$;

-- generic policy installer: read perm, optional write perm (null => no client writes)
create or replace function apply_standard_rls(tbl regclass, read_perm text, write_perm text) returns void
language plpgsql as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('create policy tenant_select on %s for select to authenticated using (company_id = current_company_id() and has_permission(%L))', tbl, read_perm);
  if write_perm is not null then
    execute format('create policy tenant_insert on %s for insert to authenticated with check (company_id = current_company_id() and has_permission(%L))', tbl, write_perm);
    execute format('create policy tenant_update on %s for update to authenticated using (company_id = current_company_id() and has_permission(%L)) with check (company_id = current_company_id())', tbl, write_perm);
    execute format('create policy tenant_delete on %s for delete to authenticated using (company_id = current_company_id() and has_permission(''records.delete''))', tbl);
  end if;
end $$;

do $$ begin
  perform apply_standard_rls('document_categories','documents.view','records.edit');
  perform apply_standard_rls('customers','documents.view','records.edit');
  perform apply_standard_rls('suppliers','documents.view','records.edit');
  perform apply_standard_rls('projects','documents.view','records.edit');
  perform apply_standard_rls('assets','documents.view','records.edit');
  perform apply_standard_rls('banks','finance.view','cheques.manage');
  perform apply_standard_rls('cheques','finance.view','cheques.manage');
  perform apply_standard_rls('invoices','finance.view','records.edit');
  perform apply_standard_rls('payments','finance.view','records.edit');
  perform apply_standard_rls('employee_compensation','salary.view','salary.view');
  perform apply_standard_rls('salary_payments','salary.view','salary.view');
  perform apply_standard_rls('employee_advances','salary.view','salary.view');
  perform apply_standard_rls('leave_records','employees.view_sensitive','employees.view_sensitive');
  perform apply_standard_rls('attendance_records','employees.view_sensitive','employees.view_sensitive');
  perform apply_standard_rls('reminders','documents.view','reminders.create');
  perform apply_standard_rls('notification_recipients','reminders.create','settings.manage');
  perform apply_standard_rls('notification_logs','reminders.create',null);   -- written by service role only
end $$;

-- ───────────── tables with bespoke policies ─────────────
alter table companies enable row level security;
create policy company_select on companies for select to authenticated using (id = current_company_id());
create policy company_update on companies for update to authenticated
  using (id = current_company_id() and has_permission('settings.manage')) with check (id = current_company_id());

alter table profiles enable row level security;
create policy profiles_select on profiles for select to authenticated using (company_id = current_company_id());
create policy profiles_update on profiles for update to authenticated
  using (company_id = current_company_id() and (id = auth.uid() or has_permission('users.manage')))
  with check (company_id = current_company_id());
-- inserts happen via create_company_with_owner() / invite flow (service role); no client insert policy.

create or replace function profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;             -- service role / migrations
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active
      or new.company_id is distinct from old.company_id) then
    if not has_permission('users.manage') then raise exception 'insufficient privilege: role changes require users.manage'; end if;
    if new.company_id is distinct from old.company_id then raise exception 'company cannot be changed'; end if;
    if new.role = 'super_admin' and old.role <> 'super_admin'
       and not exists (select 1 from profiles where id = auth.uid() and role = 'super_admin') then
      raise exception 'only a super admin can grant super_admin';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard_t before update on profiles for each row execute function profiles_guard();

alter table role_permissions enable row level security;
create policy rp_select on role_permissions for select to authenticated using (true);

alter table employees enable row level security;
create policy emp_select on employees for select to authenticated using (
  company_id = current_company_id() and (has_permission('employees.view') or user_id = auth.uid()));
create policy emp_insert on employees for insert to authenticated with check (
  company_id = current_company_id() and has_permission('records.edit') and has_permission('employees.view_sensitive'));
create policy emp_update on employees for update to authenticated using (
  company_id = current_company_id() and has_permission('records.edit') and has_permission('employees.view_sensitive'))
  with check (company_id = current_company_id());
create policy emp_delete on employees for delete to authenticated using (
  company_id = current_company_id() and has_permission('records.delete'));

alter table documents enable row level security;
create policy doc_select on documents for select to authenticated using (
  company_id = current_company_id()
  and (deleted_at is null or has_permission('records.delete'))
  and can_view_document(owner_type, owner_id));
create policy doc_insert on documents for insert to authenticated with check (
  company_id = current_company_id() and has_permission('documents.upload')
  and (owner_type <> 'employee' or has_permission('employees.view_sensitive'))
  and (owner_type <> 'cheque' or has_permission('finance.view')));
create policy doc_update on documents for update to authenticated using (
  company_id = current_company_id() and has_permission('records.edit') and can_view_document(owner_type, owner_id))
  with check (company_id = current_company_id());
-- no DELETE policy: documents are only ever soft-deleted.

create or replace function documents_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and (new.deleted_at is distinct from old.deleted_at) and not has_permission('records.delete') then
    raise exception 'insufficient privilege: deleting/restoring documents requires records.delete';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger documents_guard_t before update on documents for each row execute function documents_guard();

alter table document_versions enable row level security;
create policy dv_select on document_versions for select to authenticated using (
  company_id = current_company_id() and exists (select 1 from documents d where d.id = document_id));
create policy dv_insert on document_versions for insert to authenticated with check (
  company_id = current_company_id() and has_permission('documents.upload')
  and exists (select 1 from documents d where d.id = document_id));
-- no UPDATE / DELETE policies: versions are immutable history.

alter table document_renewals enable row level security;
create policy dr_select on document_renewals for select to authenticated using (
  company_id = current_company_id() and exists (select 1 from documents d where d.id = document_id));
create policy dr_insert on document_renewals for insert to authenticated with check (
  company_id = current_company_id() and has_permission('records.edit')
  and exists (select 1 from documents d where d.id = document_id));

alter table document_access_logs enable row level security;
create policy dal_select on document_access_logs for select to authenticated using (
  company_id = current_company_id() and has_permission('audit.view'));
create policy dal_insert on document_access_logs for insert to authenticated with check (
  company_id = current_company_id() and user_id = auth.uid()
  and exists (select 1 from documents d where d.id = document_id));

alter table in_app_notifications enable row level security;
create policy ian_select on in_app_notifications for select to authenticated using (user_id = auth.uid());
create policy ian_update on in_app_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table app_settings enable row level security;
create policy as_select on app_settings for select to authenticated using (company_id = current_company_id());
create policy as_write on app_settings for insert to authenticated with check (company_id = current_company_id() and has_permission('settings.manage'));
create policy as_update on app_settings for update to authenticated using (company_id = current_company_id() and has_permission('settings.manage')) with check (company_id = current_company_id());

alter table integration_secrets enable row level security;     -- intentionally NO policies: service role only
alter table audit_logs enable row level security;
create policy audit_select on audit_logs for select to authenticated using (company_id = current_company_id() and has_permission('audit.view'));
-- no insert/update/delete policies: append-only via trigger (security definer)

-- ───────────── audit trail ─────────────
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare rec jsonb; cid uuid; rid uuid; payload jsonb;
begin
  rec := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  cid := coalesce((rec->>'company_id')::uuid, case when tg_table_name = 'companies' then (rec->>'id')::uuid end);
  rid := nullif(rec->>'id','')::uuid;
  if tg_table_name in ('employee_compensation','salary_payments','employee_advances') then
    payload := jsonb_build_object('redacted', true);          -- never copy salary values into the audit log
  elsif tg_op = 'UPDATE' then
    payload := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  else payload := rec; end if;
  insert into audit_logs(company_id, user_id, action, table_name, record_id, changes)
  values (cid, auth.uid(), tg_op, tg_table_name, rid, payload);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['companies','profiles','documents','document_versions','document_renewals','employees',
    'employee_compensation','salary_payments','employee_advances','cheques','banks','customers','suppliers',
    'projects','invoices','payments','assets','notification_recipients','app_settings','reminders']
  loop execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row()', t); end loop;
end $$;

-- ───────────── cheque integrity ─────────────
create or replace function cheque_transition_ok(dir text, from_s text, to_s text) returns boolean
language sql immutable as $$
  select case
    when from_s = to_s then true
    when dir = 'incoming' then (from_s, to_s) in
      (('received','scheduled'),('received','deposited'),('received','cancelled'),
       ('scheduled','deposited'),('scheduled','cancelled'),
       ('deposited','cleared'),('deposited','returned'),
       ('returned','deposited'),('returned','cancelled'))
    when dir = 'outgoing' then (from_s, to_s) in
      (('issued','scheduled'),('issued','presented'),('issued','cleared'),('issued','returned'),('issued','cancelled'),
       ('scheduled','presented'),('scheduled','cleared'),('scheduled','returned'),('scheduled','cancelled'),
       ('presented','cleared'),('presented','returned'),
       ('returned','issued'),('returned','cancelled'))
    else false end
$$;

create or replace function cheques_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.direction = 'incoming' and new.status not in ('received','scheduled') then
      raise exception 'new incoming cheques must start as received or scheduled'; end if;
    if new.direction = 'outgoing' and new.status not in ('issued','scheduled') then
      raise exception 'new outgoing cheques must start as issued or scheduled'; end if;
    return new;
  end if;
  if new.direction is distinct from old.direction then raise exception 'cheque direction cannot change'; end if;
  if new.status is distinct from old.status then
    if not cheque_transition_ok(old.direction, old.status, new.status) then
      raise exception 'invalid cheque status change: % -> %', old.status, new.status; end if;
    if new.status = 'cleared' then           -- manual confirmation by an authorised user
      new.cleared_at := now(); new.cleared_by := auth.uid();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger cheques_guard_t before insert or update on cheques for each row execute function cheques_guard();

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger employees_touch before update on employees for each row execute function touch_updated_at();

-- ───────────── reminder source view (RLS applies to the caller) ─────────────
create view reminder_sources with (security_invoker = true) as
  select d.company_id, 'document'::text as source_type, d.id as source_id,
         d.name as title,
         case when d.owner_type = 'employee' then (select e.full_name from employees e where e.id = d.owner_id) end as subject,
         coalesce(c.name, '') as category,
         d.owner_type as owner_type,
         d.expiry_date as due_date,
         coalesce(d.reminder_days, c.default_reminder_days) as offsets,
         null::numeric as amount, null::text as direction,
         case when d.owner_type = 'employee' then '/employees/' || d.owner_id else '/documents/' || d.id end as link
  from documents d left join document_categories c on c.id = d.category_id
  where d.deleted_at is null and d.reminders_active and d.expiry_date is not null and d.status <> 'cancelled'
  union all
  select ch.company_id, 'cheque', ch.id, 'Cheque ' || ch.cheque_no, ch.party_name, ch.bank_name, ch.direction,
         ch.cheque_date, null, ch.amount, ch.direction, '/cheques?open=' || ch.id
  from cheques ch where ch.status in ('received','issued','scheduled','deposited','presented')
  union all
  select r.company_id, 'custom', r.id, r.title, null, 'Custom', 'custom', r.due_date, r.offsets, null, null, '/reminders'
  from reminders r where r.enabled
  union all
  select i.company_id, 'invoice', i.id, i.doc_type || ' ' || i.number, null, 'Invoice', 'invoice', i.due_date, null,
         i.total, null, '/invoices'
  from invoices i where i.doc_type = 'invoice' and i.status in ('sent','partially_paid','overdue') and i.due_date is not null;
