-- 0016: Approval Center, saved views, custom fields & custom statuses, per-user preferences (dashboard widgets).
-- Additive only: new tables, nullable columns, triggers. Existing quotation approval (invoices.approval_status) stays the
-- source of truth for sales documents; approval_requests mirrors it so every approval lives in one inbox.

-- ───────────── permission ─────────────
insert into role_permissions(role, permission) values ('super_admin','approvals.decide'),('company_owner','approvals.decide') on conflict do nothing;

-- ───────────── approval requests ─────────────
create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('quotation','purchase_order','invoice','credit_note','expense','cheque','other')),
  entity_id uuid,
  title text not null check (length(title) between 1 and 200),
  details text check (length(details) <= 4000),
  amount numeric(14,2),
  status text not null default 'pending' check (status in ('pending','approved','rejected','changes_requested','cancelled')),
  requested_by uuid references profiles(id) on delete set null default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 2000),
  check ((entity_type = 'other') = (entity_id is null))
);
create index if not exists approval_requests_open_idx on approval_requests(company_id, status, requested_at desc);
create unique index if not exists approval_requests_one_open on approval_requests(entity_type, entity_id) where status = 'pending' and entity_id is not null;
alter table approval_requests enable row level security;
-- requesters see their own requests; deciders and finance see everything in the company
create policy ar_select on approval_requests for select to authenticated using (company_id = current_company_id() and (requested_by = auth.uid() or has_permission('approvals.decide') or has_permission('sales.approve') or has_permission('finance.view')));
create policy ar_insert on approval_requests for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit') and status = 'pending');
create policy ar_update on approval_requests for update to authenticated using (company_id = current_company_id() and (has_permission('approvals.decide') or has_permission('sales.approve') or requested_by = auth.uid())) with check (company_id = current_company_id());
create trigger audit_approval_requests after insert or update or delete on approval_requests for each row execute function audit_row();

-- a requester may only cancel their own pending request; deciding needs approvals.decide (sales documents: sales.approve too)
create or replace function approval_requests_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- kept in step by the invoices sync trigger (already permission-checked there)
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status <> 'pending' then raise exception 'This request was already decided.'; end if;
    if new.status = 'cancelled' then
      if old.requested_by is distinct from auth.uid() and not has_permission('approvals.decide') and auth.uid() is not null then raise exception 'Only the requester can cancel a request.'; end if;
    elsif auth.uid() is not null and not (has_permission('approvals.decide') or (old.entity_type in ('quotation','purchase_order','invoice','credit_note') and has_permission('sales.approve'))) then
      raise exception 'You are not allowed to decide approvals.';
    end if;
    if new.status <> 'cancelled' then new.decided_at := coalesce(new.decided_at, now()); new.decided_by := coalesce(new.decided_by, auth.uid()); end if;
  end if;
  return new;
end $$;
create trigger approval_requests_guard_t before update on approval_requests for each row execute function approval_requests_guard();

-- in-app notification to everyone who can decide (and back to the requester once decided)
create or replace function approval_requests_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into in_app_notifications(company_id, user_id, title, body, link, severity, dedupe_key)
      select new.company_id, p.id, 'Approval needed: ' || new.title,
             case when new.amount is not null then 'AED ' || to_char(new.amount, 'FM999,999,999,990.00') end, '/approvals?open=' || new.id, 'warning', 'approval:' || new.id
      from profiles p join role_permissions rp on rp.role = p.role
      where p.company_id = new.company_id and p.is_active and rp.permission = 'approvals.decide' and p.id is distinct from new.requested_by
      on conflict do nothing;
  elsif new.status is distinct from old.status and new.status in ('approved','rejected','changes_requested') and new.requested_by is not null and new.requested_by is distinct from new.decided_by then
    insert into in_app_notifications(company_id, user_id, title, body, link, severity, dedupe_key)
      values (new.company_id, new.requested_by, initcap(replace(new.status, '_', ' ')) || ': ' || new.title, new.decision_note, '/approvals?open=' || new.id,
              case when new.status = 'approved' then 'info' else 'warning' end, 'approval_decided:' || new.id)
      on conflict do nothing;
  end if;
  return null;
end $$;
create trigger approval_requests_notify_t after insert or update on approval_requests for each row execute function approval_requests_notify();

-- sales documents: invoices.approval_status ↔ approval_requests (either side may change; the other follows)
create or replace function invoices_approval_sync() returns trigger language plpgsql security definer set search_path = public as $$
declare et text := case when new.doc_type in ('quotation','purchase_order','invoice','credit_note') then new.doc_type end;
begin
  if et is null or new.approval_status is not distinct from (case when tg_op = 'UPDATE' then old.approval_status end) then return null; end if;
  if new.approval_status = 'pending' then
    insert into approval_requests(company_id, entity_type, entity_id, title, amount, requested_by)
      values (new.company_id, et, new.id, initcap(replace(et, '_', ' ')) || ' ' || new.number || coalesce(' · ' || nullif(new.customer_name, ''), ''), new.total, auth.uid())
      on conflict do nothing;
  elsif new.approval_status in ('approved','rejected','changes_requested') then
    update approval_requests set status = new.approval_status, decision_note = coalesce(new.approval_note, decision_note),
           decided_by = coalesce(new.approved_by, auth.uid()), decided_at = coalesce(new.approved_at, now())
      where entity_type = et and entity_id = new.id and status = 'pending';
  elsif new.approval_status is null then
    update approval_requests set status = 'cancelled' where entity_type = et and entity_id = new.id and status = 'pending';
  end if;
  return null;
end $$;
create trigger invoices_approval_sync_t after insert or update of approval_status on invoices for each row execute function invoices_approval_sync();

-- ───────────── approval rules (Settings → Approvals) ─────────────
-- app_settings: approvals.po_required (bool), approvals.expense_threshold (AED), approvals.cheque_threshold (AED; outgoing cheques)
create or replace function approval_setting(cid uuid, k text) returns jsonb language sql stable security definer set search_path = public as $$
  select value from app_settings where company_id = cid and key = k
$$;

alter table project_expenses add column if not exists approval_status text check (approval_status in ('pending','approved','rejected','changes_requested'));
alter table cheques add column if not exists approval_status text check (approval_status in ('pending','approved','rejected','changes_requested'));

create or replace function needs_approval_before() returns trigger language plpgsql security definer set search_path = public as $$
declare lim jsonb;
begin
  if tg_table_name = 'project_expenses' then
    lim := approval_setting(new.company_id, 'approvals.expense_threshold');
    if jsonb_typeof(lim) = 'number' and (lim)::numeric > 0 and new.amount >= (lim)::numeric then new.approval_status := 'pending'; end if;
  elsif tg_table_name = 'cheques' then
    lim := approval_setting(new.company_id, 'approvals.cheque_threshold');
    if new.direction = 'outgoing' and jsonb_typeof(lim) = 'number' and (lim)::numeric > 0 and new.amount >= (lim)::numeric then new.approval_status := 'pending'; end if;
  elsif tg_table_name = 'invoices' then
    if new.doc_type = 'purchase_order' and approval_setting(new.company_id, 'approvals.po_required') = 'true'::jsonb and new.approval_status is null then new.approval_status := 'pending'; end if;
  end if;
  return new;
end $$;
create trigger project_expenses_needs_approval before insert on project_expenses for each row execute function needs_approval_before();
create trigger cheques_needs_approval before insert on cheques for each row execute function needs_approval_before();
create trigger invoices_needs_approval before insert on invoices for each row execute function needs_approval_before();

create or replace function needs_approval_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.approval_status = 'pending' then
    if tg_table_name = 'project_expenses' then
      insert into approval_requests(company_id, entity_type, entity_id, title, amount, details, requested_by)
        values (new.company_id, 'expense', new.id, 'Expense · ' || left(new.description, 120), new.amount, new.reference, coalesce(auth.uid(), new.created_by)) on conflict do nothing;
    else
      insert into approval_requests(company_id, entity_type, entity_id, title, amount, requested_by)
        values (new.company_id, 'cheque', new.id, 'Outgoing cheque ' || new.cheque_no || coalesce(' · ' || nullif(new.party_name, ''), ''), new.amount, auth.uid()) on conflict do nothing;
    end if;
  end if;
  return null;
end $$;
create trigger project_expenses_request after insert on project_expenses for each row execute function needs_approval_after();
create trigger cheques_request after insert on cheques for each row execute function needs_approval_after();

-- an outgoing cheque waiting for (or refused) approval cannot move on from "issued"
create or replace function cheques_approval_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.approval_status in ('pending','rejected','changes_requested') and new.status is distinct from old.status and new.status not in ('issued','cancelled') then
    raise exception 'This cheque is waiting for approval (Approvals) and cannot change status yet.';
  end if;
  return new;
end $$;
create trigger cheques_approval_guard_t before update of status on cheques for each row execute function cheques_approval_guard();

-- ───────────── saved views (list filters) ─────────────
create table if not exists saved_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  page text not null check (page ~ '^/[a-z0-9/-]{0,60}$'),
  name text not null check (length(name) between 1 and 60),
  query text not null default '' check (length(query) <= 1000),
  shared boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists saved_views_page_idx on saved_views(company_id, page);
alter table saved_views enable row level security;
create policy sv_select on saved_views for select to authenticated using (company_id = current_company_id() and (user_id = auth.uid() or shared));
create policy sv_insert on saved_views for insert to authenticated with check (company_id = current_company_id() and user_id = auth.uid() and (not shared or has_permission('records.edit')));
create policy sv_delete on saved_views for delete to authenticated using (company_id = current_company_id() and (user_id = auth.uid() or (shared and has_permission('settings.manage'))));

-- ───────────── custom fields ─────────────
create or replace function custom_entity_perm(entity text) returns text language sql immutable as $$
  select case entity when 'employee' then 'employees.view' when 'lead' then 'crm.view' else 'documents.view' end
$$;
create table if not exists custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  entity text not null check (entity in ('customer','project','employee','asset','lead','task','work_order')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(label) between 1 and 60),
  field_type text not null check (field_type in ('text','textarea','number','date','select','checkbox')),
  options text[] not null default '{}',
  required boolean not null default false,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, entity, key)
);
alter table custom_field_defs enable row level security;
create policy cfd_select on custom_field_defs for select to authenticated using (company_id = current_company_id());
create policy cfd_write on custom_field_defs for all to authenticated using (company_id = current_company_id() and has_permission('settings.manage')) with check (company_id = current_company_id() and has_permission('settings.manage'));
create trigger audit_custom_field_defs after insert or update or delete on custom_field_defs for each row execute function audit_row();

create table if not exists custom_field_values (
  company_id uuid not null references companies(id) on delete cascade,
  entity text not null,
  record_id uuid not null,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (entity, record_id)
);
alter table custom_field_values enable row level security;
create policy cfv_select on custom_field_values for select to authenticated using (company_id = current_company_id() and has_permission(custom_entity_perm(entity)));
create policy cfv_insert on custom_field_values for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit') and has_permission(custom_entity_perm(entity)));
create policy cfv_update on custom_field_values for update to authenticated using (company_id = current_company_id() and has_permission('records.edit') and has_permission(custom_entity_perm(entity))) with check (company_id = current_company_id());
-- audit (custom_field_values has no id column: record_id is used as the record)
create or replace function audit_custom_values() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs(company_id, user_id, action, table_name, record_id, changes)
  values (new.company_id, auth.uid(), tg_op, 'custom_field_values', new.record_id,
          jsonb_build_object('entity', new.entity, 'old', case when tg_op = 'UPDATE' then old.data end, 'new', new.data));
  return null;
end $$;
create trigger audit_custom_field_values after insert or update on custom_field_values for each row execute function audit_custom_values();

-- ───────────── custom statuses (each maps to a built-in status, so workflow rules keep working) ─────────────
create table if not exists custom_statuses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  entity text not null check (entity in ('task','project','lead','work_order')),
  label text not null check (length(label) between 1 and 40),
  base_status text not null check (length(base_status) between 1 and 40),
  color text not null default 'neutral' check (color in ('neutral','blue','green','amber','red')),
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, entity, label)
);
alter table custom_statuses enable row level security;
create policy cs_select on custom_statuses for select to authenticated using (company_id = current_company_id());
create policy cs_write on custom_statuses for all to authenticated using (company_id = current_company_id() and has_permission('settings.manage')) with check (company_id = current_company_id() and has_permission('settings.manage'));
create trigger audit_custom_statuses after insert or update or delete on custom_statuses for each row execute function audit_row();

alter table tasks add column if not exists custom_status_id uuid references custom_statuses(id) on delete set null;
alter table projects add column if not exists custom_status_id uuid references custom_statuses(id) on delete set null;
alter table leads add column if not exists custom_status_id uuid references custom_statuses(id) on delete set null;
alter table work_orders add column if not exists custom_status_id uuid references custom_statuses(id) on delete set null;

-- picking a custom status sets the built-in status it maps to; changing the built-in status directly clears a custom one that no longer matches
create or replace function apply_custom_status() returns trigger language plpgsql security definer set search_path = public as $$
declare cs custom_statuses; col text := case when tg_table_name = 'leads' then 'stage' else 'status' end; cur text;
begin
  cur := to_jsonb(new)->>col;
  if new.custom_status_id is not null and (tg_op = 'INSERT' or new.custom_status_id is distinct from old.custom_status_id) then
    select * into cs from custom_statuses where id = new.custom_status_id and company_id = new.company_id and active;
    if not found then raise exception 'Unknown custom status.'; end if;
    if cs.entity <> (case tg_table_name when 'tasks' then 'task' when 'projects' then 'project' when 'leads' then 'lead' else 'work_order' end) then raise exception 'That status belongs to another record type.'; end if;
    new := jsonb_populate_record(new, jsonb_build_object(col, cs.base_status));
  elsif new.custom_status_id is not null and tg_op = 'UPDATE' and cur is distinct from (to_jsonb(old)->>col) then
    if not exists (select 1 from custom_statuses where id = new.custom_status_id and base_status = cur) then new.custom_status_id := null; end if;
  end if;
  return new;
end $$;
create trigger tasks_custom_status before insert or update on tasks for each row execute function apply_custom_status();
create trigger projects_custom_status before insert or update on projects for each row execute function apply_custom_status();
create trigger leads_custom_status before insert or update on leads for each row execute function apply_custom_status();
create trigger work_orders_custom_status before insert or update on work_orders for each row execute function apply_custom_status();

-- ───────────── per-user preferences (dashboard widgets, …) ─────────────
create table if not exists user_preferences (
  user_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  key text not null check (key ~ '^[a-z][a-z0-9_.]{0,40}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table user_preferences enable row level security;
create policy up_own on user_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
