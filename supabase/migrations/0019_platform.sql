-- 0019: platform — sign-in history and device sessions, an internal event stream (feeds notification rules and webhooks),
-- API keys, scheduled reports, scheduler health and import batches (with undo). Additive only.

-- ───────────── sign-in history ─────────────
create table if not exists login_events (
  id bigint generated always as identity primary key,
  company_id uuid references companies(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  email text check (length(email) <= 320),
  event text not null check (event in ('sign_in','sign_in_failed','mfa_verified','mfa_failed','sign_out','session_revoked','sessions_revoked')),
  session_id uuid,
  ip text check (length(ip) <= 64),
  user_agent text check (length(user_agent) <= 300),
  detail text check (length(detail) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists login_events_user_idx on login_events(user_id, created_at desc);
create index if not exists login_events_company_idx on login_events(company_id, created_at desc);
alter table login_events enable row level security;
-- written by the server only; people see their own history, user managers see the company's
create policy le_select on login_events for select to authenticated using (user_id = auth.uid() or (company_id = current_company_id() and has_permission('users.manage')));

-- ───────────── device sessions ─────────────
-- id = the session id inside the Supabase access token (stays the same across token refreshes)
create table if not exists user_sessions (
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  ip text check (length(ip) <= 64),
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null
);
create index if not exists user_sessions_user_idx on user_sessions(user_id, last_seen_at desc);
alter table user_sessions enable row level security;
create policy us_select on user_sessions for select to authenticated using (user_id = auth.uid() or (company_id = current_company_id() and has_permission('users.manage')));

-- called on every signed-in request: registers the device the first time, refreshes "last seen" at most every 5 minutes,
-- and answers whether this session has been signed out from another device (true = revoked)
create or replace function touch_session(p_sid uuid, p_ip text, p_ua text) returns boolean
language plpgsql security definer set search_path = public as $$
declare r user_sessions; uid uuid := auth.uid(); cid uuid := current_company_id();
begin
  if uid is null or p_sid is null or cid is null then return false; end if;
  select * into r from user_sessions where id = p_sid;
  if not found then
    insert into user_sessions(id, user_id, company_id, ip, user_agent) values (p_sid, uid, cid, left(p_ip, 64), left(p_ua, 300)) on conflict (id) do nothing;
    return false;
  end if;
  if r.user_id <> uid then return false; end if;
  if r.revoked_at is not null then return true; end if;
  if r.last_seen_at < now() - interval '5 minutes' then
    update user_sessions set last_seen_at = now(), ip = coalesce(left(p_ip, 64), ip), user_agent = coalesce(left(p_ua, 300), user_agent) where id = p_sid;
  end if;
  return false;
end $$;
revoke all on function touch_session(uuid, text, text) from public, anon;
grant execute on function touch_session(uuid, text, text) to authenticated;

-- sign out one device: your own, or anyone's in the company with users.manage
create or replace function revoke_session(p_sid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare r user_sessions;
begin
  select * into r from user_sessions where id = p_sid and revoked_at is null;
  if not found then return false; end if;
  if not (r.user_id = auth.uid() or (r.company_id = current_company_id() and has_permission('users.manage'))) then raise exception 'insufficient privilege'; end if;
  update user_sessions set revoked_at = now(), revoked_by = auth.uid() where id = p_sid;
  insert into login_events(company_id, user_id, event, session_id, detail)
    values (r.company_id, r.user_id, 'session_revoked', p_sid, case when r.user_id = auth.uid() then 'by the user' else 'by an administrator' end);
  return true;
end $$;
revoke all on function revoke_session(uuid) from public, anon;
grant execute on function revoke_session(uuid) to authenticated;

-- sign out every other device of the caller (or of p_user, for user managers); returns how many were signed out
create or replace function revoke_other_sessions(p_keep uuid, p_user uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := coalesce(p_user, auth.uid()); n int;
begin
  if uid <> auth.uid() and not (has_permission('users.manage') and exists (select 1 from profiles p where p.id = uid and p.company_id = current_company_id())) then
    raise exception 'insufficient privilege';
  end if;
  update user_sessions set revoked_at = now(), revoked_by = auth.uid() where user_id = uid and revoked_at is null and id is distinct from p_keep;
  get diagnostics n = row_count;
  if n > 0 then insert into login_events(company_id, user_id, event, detail) values (current_company_id(), uid, 'sessions_revoked', n || ' device(s)'); end if;
  return n;
end $$;
revoke all on function revoke_other_sessions(uuid, uuid) from public, anon;
grant execute on function revoke_other_sessions(uuid, uuid) to authenticated;

-- failed sign-ins are attributed to the account (if any) so its owner and the user manager can see them. Service role only.
create or replace function profile_for_email(p_email text) returns table(id uuid, company_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.company_id from auth.users u join profiles p on p.id = u.id where lower(u.email) = lower(p_email) limit 1
$$;
revoke all on function profile_for_email(text) from public, anon, authenticated;
grant execute on function profile_for_email(text) to service_role;

-- ───────────── import batches (wizard) ─────────────
create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  entity text not null check (entity in ('customers','suppliers','catalog_items','employees','leads')),
  file_name text check (length(file_name) <= 200),
  total int not null default 0, imported int not null default 0, skipped int not null default 0, failed int not null default 0,
  mapping jsonb not null default '{}',
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  undone_at timestamptz, undone_by uuid references profiles(id) on delete set null
);
create index if not exists import_batches_company_idx on import_batches(company_id, created_at desc);
alter table import_batches enable row level security;
create policy ib_select on import_batches for select to authenticated using (company_id = current_company_id() and has_permission('records.edit'));
create policy ib_insert on import_batches for insert to authenticated with check (company_id = current_company_id() and has_permission('records.edit'));
create policy ib_update on import_batches for update to authenticated using (company_id = current_company_id() and has_permission('records.edit')) with check (company_id = current_company_id());
create trigger audit_import_batches after insert or update or delete on import_batches for each row execute function audit_row();

alter table customers add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table suppliers add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table catalog_items add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table employees add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table leads add column if not exists import_batch_id uuid references import_batches(id) on delete set null;

-- ───────────── event stream ─────────────
-- Business events written by triggers in the same transaction as the change. A server worker turns each event into
-- notification-rule messages and webhook deliveries. Data kept here is a short, non-sensitive summary.
create table if not exists app_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  event text not null check (event ~ '^[a-z_]+\.[a-z_]+$'),
  entity text not null,
  entity_id uuid,
  data jsonb not null default '{}',
  actor uuid default auth.uid(),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz
);
create index if not exists app_events_pending_idx on app_events(id) where processed_at is null;
create index if not exists app_events_company_idx on app_events(company_id, created_at desc);
alter table app_events enable row level security;
create policy ae_select on app_events for select to authenticated using (company_id = current_company_id() and has_permission('settings.manage'));

create or replace function emit_app_event() returns trigger language plpgsql security definer set search_path = public as $$
declare ev text; d jsonb := '{}';
begin
  if tg_table_name = 'invoices' then
    if new.deleted_at is not null then return null; end if;
    if tg_op = 'INSERT' then ev := new.doc_type || '.created';
    elsif new.status is distinct from old.status then
      ev := case
        when new.doc_type = 'quotation' and new.status in ('sent','accepted','rejected') then 'quotation.' || new.status
        when new.doc_type = 'invoice' and new.status in ('sent','paid','overdue') then 'invoice.' || new.status
        when new.doc_type = 'delivery_note' and new.status = 'delivered' then 'delivery_note.delivered'
        when new.doc_type = 'purchase_order' and new.status = 'sent' then 'purchase_order.sent' end;
    end if;
    d := jsonb_build_object('number', new.number, 'status', new.status, 'party', new.customer_name, 'amount', new.total, 'date', new.issue_date, 'due_date', new.due_date);
  elsif tg_table_name = 'customers' then
    if new.import_batch_id is not null then return null; end if;   -- bulk imports do not alert per row
    if tg_op = 'INSERT' then ev := 'customer.created'; d := jsonb_build_object('name', new.name); end if;
  elsif tg_table_name = 'payments' then
    if tg_op = 'INSERT' then
      ev := 'payment.received';
      d := jsonb_build_object('amount', new.amount, 'date', new.paid_on, 'method', new.method)
        || coalesce((select jsonb_build_object('number', i.number, 'party', i.customer_name) from invoices i where i.id = new.invoice_id), '{}');
    end if;
  elsif tg_table_name = 'project_expenses' then
    if tg_op = 'INSERT' then ev := 'expense.created'; d := jsonb_build_object('title', new.description, 'amount', new.amount, 'category', new.category, 'date', new.spent_on); end if;
  elsif tg_table_name = 'leads' then
    if tg_op = 'INSERT' and new.import_batch_id is not null then return null; end if;
    if tg_op = 'INSERT' then ev := 'lead.created';
    elsif new.stage is distinct from old.stage and new.stage in ('won','lost') then ev := 'lead.' || new.stage; end if;
    d := jsonb_build_object('number', new.number, 'party', new.company_name, 'source', new.source, 'amount', new.estimated_value, 'status', new.stage);
  elsif tg_table_name = 'service_tickets' then
    if tg_op = 'INSERT' then ev := 'ticket.created';
    elsif new.status is distinct from old.status and new.status = 'resolved' then ev := 'ticket.resolved'; end if;
    d := jsonb_build_object('number', new.number, 'title', new.title, 'priority', new.priority, 'category', new.category, 'source', new.source, 'status', new.status);
  elsif tg_table_name = 'approval_requests' then
    if tg_op = 'INSERT' then ev := 'approval.requested'; d := jsonb_build_object('title', new.title, 'amount', new.amount, 'type', new.entity_type); end if;
  elsif tg_table_name = 'cheques' then
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'returned' then
      ev := 'cheque.returned'; d := jsonb_build_object('number', new.cheque_no, 'party', new.party_name, 'amount', new.amount, 'direction', new.direction, 'date', new.cheque_date);
    end if;
  end if;
  if ev is null then return null; end if;
  insert into app_events(company_id, event, entity, entity_id, data) values (new.company_id, ev, tg_table_name, new.id, jsonb_strip_nulls(d));
  return null;
end $$;
create trigger emit_event_invoices after insert or update of status on invoices for each row execute function emit_app_event();
create trigger emit_event_customers after insert on customers for each row execute function emit_app_event();
create trigger emit_event_payments after insert on payments for each row execute function emit_app_event();
create trigger emit_event_project_expenses after insert on project_expenses for each row execute function emit_app_event();
create trigger emit_event_leads after insert or update of stage on leads for each row execute function emit_app_event();
create trigger emit_event_service_tickets after insert or update of status on service_tickets for each row execute function emit_app_event();
create trigger emit_event_approval_requests after insert on approval_requests for each row execute function emit_app_event();
create trigger emit_event_cheques after update of status on cheques for each row execute function emit_app_event();

-- worker claim (crash-safe: a claim older than 10 minutes is taken again). Service role only.
create or replace function claim_app_events(p_limit int default 200) returns setof app_events
language plpgsql security definer set search_path = public as $$
begin
  return query
  update app_events e set claimed_at = now()
   where e.id in (select x.id from app_events x where x.processed_at is null and (x.claimed_at is null or x.claimed_at < now() - interval '10 minutes')
                  order by x.id limit p_limit for update skip locked)
  returning e.*;
end $$;
revoke all on function claim_app_events(int) from public, anon, authenticated;
grant execute on function claim_app_events(int) to service_role;

-- ───────────── notification rules ─────────────
create table if not exists notification_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  event text not null check (event ~ '^[a-z_]+\.[a-z_]+$'),
  min_amount numeric(14,2) check (min_amount is null or min_amount >= 0),
  channels text[] not null default '{in_app}' check (channels <@ array['in_app','email','whatsapp'] and cardinality(channels) between 1 and 3),
  recipient_ids uuid[] not null check (cardinality(recipient_ids) between 1 and 50),
  enabled boolean not null default true,
  fire_count int not null default 0,
  last_fired_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists notification_rules_event_idx on notification_rules(company_id, event) where enabled;
alter table notification_rules enable row level security;
create policy nr_all on notification_rules for all to authenticated using (company_id = current_company_id() and has_permission('settings.manage')) with check (company_id = current_company_id() and has_permission('settings.manage'));
create trigger audit_notification_rules after insert or update or delete on notification_rules for each row execute function audit_row();

-- ───────────── webhooks ─────────────
create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  url text not null check (url ~ '^https?://[^[:space:]]{4,}$' and length(url) <= 510),
  description text check (length(description) <= 200),
  events text[] not null check (cardinality(events) between 1 and 40),
  enabled boolean not null default true,
  secret_hint text check (length(secret_hint) <= 12),
  failure_count int not null default 0,
  last_status int, last_success_at timestamptz, last_failure_at timestamptz,
  disabled_reason text check (length(disabled_reason) <= 200),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table webhook_endpoints enable row level security;
create policy we_all on webhook_endpoints for all to authenticated using (company_id = current_company_id() and has_permission('settings.manage')) with check (company_id = current_company_id() and has_permission('settings.manage'));
create trigger audit_webhook_endpoints after insert or update or delete on webhook_endpoints for each row execute function audit_row();

-- signing secrets: service role only (no policies), never readable from the browser
create table if not exists webhook_secrets (
  endpoint_id uuid primary key references webhook_endpoints(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  secret text not null check (length(secret) between 32 and 128),
  rotated_at timestamptz not null default now()
);
alter table webhook_secrets enable row level security;

create table if not exists webhook_deliveries (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_id bigint references app_events(id) on delete set null,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','retry','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  response_status int, response_ms int,
  last_error text check (length(last_error) <= 500),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create unique index if not exists webhook_deliveries_once on webhook_deliveries(endpoint_id, event_id);   -- test pings have no event (NULLs never clash)
create index if not exists webhook_deliveries_due_idx on webhook_deliveries(next_attempt_at) where status in ('pending','retry','sending');
create index if not exists webhook_deliveries_endpoint_idx on webhook_deliveries(endpoint_id, created_at desc);
alter table webhook_deliveries enable row level security;
create policy wd_select on webhook_deliveries for select to authenticated using (company_id = current_company_id() and has_permission('settings.manage'));

create or replace function claim_webhook_deliveries(p_limit int default 25) returns setof webhook_deliveries
language plpgsql security definer set search_path = public as $$
begin
  return query
  update webhook_deliveries d set status = 'sending', claimed_at = now()
   where d.id in (select x.id from webhook_deliveries x
                   where (x.status in ('pending','retry') and x.next_attempt_at <= now()) or (x.status = 'sending' and x.claimed_at < now() - interval '10 minutes')
                   order by x.next_attempt_at limit p_limit for update skip locked)
  returning d.*;
end $$;
revoke all on function claim_webhook_deliveries(int) from public, anon, authenticated;
grant execute on function claim_webhook_deliveries(int) to service_role;

-- ───────────── API keys ─────────────
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  prefix text not null check (length(prefix) between 8 and 20),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 10 and scopes <@ array['customers.read','invoices.read','quotations.read','payments.read','projects.read','leads.read','tickets.read']),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  use_count bigint not null default 0,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table api_keys enable row level security;
create policy ak_select on api_keys for select to authenticated using (company_id = current_company_id() and has_permission('settings.manage'));
create policy ak_insert on api_keys for insert to authenticated with check (company_id = current_company_id() and has_permission('settings.manage'));
create policy ak_update on api_keys for update to authenticated using (company_id = current_company_id() and has_permission('settings.manage')) with check (company_id = current_company_id());
create trigger audit_api_keys after insert or update or delete on api_keys for each row execute function audit_row();

-- ───────────── scheduled reports ─────────────
create table if not exists report_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  frequency text not null check (frequency in ('weekly','monthly')),
  weekday int check (weekday between 1 and 7),          -- ISO: 1 = Monday
  month_day int check (month_day between 1 and 28),
  sections text[] not null check (cardinality(sections) >= 1 and sections <@ array['sales','collections','expenses','receivables','crm','service']),
  channels text[] not null check (cardinality(channels) between 1 and 3 and channels <@ array['in_app','email','whatsapp']),
  recipient_ids uuid[] not null check (cardinality(recipient_ids) between 1 and 50),
  enabled boolean not null default true,
  last_period text, last_sent_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check ((frequency = 'weekly') = (weekday is not null)),
  check ((frequency = 'monthly') = (month_day is not null))
);
alter table report_schedules enable row level security;
create policy rs_all on report_schedules for all to authenticated using (company_id = current_company_id() and has_permission('settings.manage')) with check (company_id = current_company_id() and has_permission('settings.manage'));
create trigger audit_report_schedules after insert or update or delete on report_schedules for each row execute function audit_row();

-- ───────────── scheduler health (job, timing, ok / error only — no business data) ─────────────
create table if not exists system_runs (
  id bigint generated always as identity primary key,
  job text not null check (job in ('cron','events')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail text check (length(detail) <= 300)
);
create index if not exists system_runs_job_idx on system_runs(job, started_at desc);
alter table system_runs enable row level security;
create policy sr_select on system_runs for select to authenticated using (has_permission('settings.manage'));

