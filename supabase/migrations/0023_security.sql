-- 0023 security hardening. Additive and permission-only: no table, column or row of business data is changed or removed.
--   1. Function execution: nobody signed out (anon) can call any database function; helpers that read across companies
--      are no longer callable by users at all (only by the database itself).
--   2. Two-step verification is enforced in the database: a session that has not completed it sees no company data.
--   3. Sessions expire after 24 hours without activity and 30 days at most.
--   4. Shared rate limits (brute-force protection that works across server instances) and a security event log.
--   5. The private document bucket only accepts the file types the app allows.

-- ───────────── 1. Function execution rights ─────────────
-- Keep exactly the access signed-in users and the service role have today, but as explicit grants, then take away the
-- default PUBLIC/anon access. (Supabase's anon role is used by signed-out visitors; the app never calls a function as anon.)
do $$
declare f record;
begin
  for f in select p.oid, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    if has_function_privilege('authenticated', f.oid, 'execute') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if has_function_privilege('service_role', f.oid, 'execute') then execute format('grant execute on function %s to service_role', f.sig); end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
-- Functions created by later migrations start without PUBLIC/anon access.
alter default privileges in schema public revoke execute on functions from public, anon;

-- approval_setting(company, key) returned any company's settings (bank details, TRN, terms…) to any caller: only the
-- approval trigger needs it, and it runs as the function owner.
revoke execute on function approval_setting(uuid, text) from authenticated;
-- invoice_credits(invoice) summed credit notes of any company's invoice: only owner-run functions use it.
revoke execute on function invoice_credits(uuid) from authenticated;
-- Trigger functions are run by the database when rows change (that never checks EXECUTE); nobody needs to call them directly.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
end $$;

-- ───────────── 2. Two-step verification enforced by the database ─────────────
-- True when the session has passed two-step verification, or the user has no verified authenticator.
create or replace function mfa_satisfied() returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified')
$$;
revoke execute on function mfa_satisfied() from public, anon;
grant execute on function mfa_satisfied() to authenticated, service_role;
-- Almost every row-level policy is scoped by current_company_id(): with an unfinished two-step sign-in it is null, so the
-- session reads and writes nothing until the code is entered (the app sends the user to /login/mfa).
create or replace function current_company_id() returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid() and is_active and mfa_satisfied()
$$;

-- ───────────── 3. Session expiry and sign-in history ─────────────
-- New sign-in history events (the existing ones are kept): expired sessions, locked sign-ins, password resets, new devices.
alter table login_events drop constraint if exists login_events_event_check;
alter table login_events add constraint login_events_event_check check (event = any (array['sign_in', 'sign_in_failed', 'mfa_verified', 'mfa_failed',
  'sign_out', 'session_revoked', 'sessions_revoked', 'session_expired', 'sign_in_locked', 'password_reset_requested', 'password_changed', 'new_device']));
-- Same as before, plus: a session idle for 24 hours, or older than 30 days, is ended (true = sign this device out).
create or replace function touch_session(p_sid uuid, p_ip text, p_ua text) returns boolean language plpgsql security definer set search_path = public as $$
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
  if r.last_seen_at < now() - interval '24 hours' or r.created_at < now() - interval '30 days' then
    update user_sessions set revoked_at = now() where id = p_sid and revoked_at is null;
    insert into login_events(company_id, user_id, event, session_id, detail)
      values (r.company_id, r.user_id, 'session_expired', p_sid, case when r.created_at < now() - interval '30 days' then 'older than 30 days' else 'inactive for 24 hours' end);
    return true;
  end if;
  if r.last_seen_at < now() - interval '5 minutes' then
    update user_sessions set last_seen_at = now(), ip = coalesce(left(p_ip, 64), ip), user_agent = coalesce(left(p_ua, 300), user_agent) where id = p_sid;
  end if;
  return false;
end $$;
revoke execute on function touch_session(uuid, text, text) from public, anon;
grant execute on function touch_session(uuid, text, text) to authenticated, service_role;

-- ───────────── 4. Rate limits and security events ─────────────
-- Fixed-window counters shared by every server instance (the in-memory limiter in middleware only sees one instance).
create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);
alter table rate_limits enable row level security;   -- no policies: only the service role (server code) touches it
revoke all on rate_limits from public, anon, authenticated;
-- Counts one hit for `p_key`; returns false once more than `p_max` hits fall in the current `p_window_seconds` window.
create or replace function rate_limit_hit(p_key text, p_max integer, p_window_seconds integer) returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into rate_limits as r (key, window_start, hits) values (left(p_key, 200), now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into n;
  if random() < 0.01 then delete from rate_limits where window_start < now() - interval '1 day'; end if;   -- occasional cleanup
  return n <= p_max;
end $$;
revoke execute on function rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, integer, integer) to service_role;

-- Security-relevant events for monitoring (failed and locked sign-ins, permission denials, rejected API keys and webhook
-- signatures, rate limits, new-device sign-ins). Written by the server (service role); readable by the company's admins.
create table if not exists security_events (
  id bigint generated always as identity primary key,
  company_id uuid references companies(id) on delete cascade,
  user_id uuid,
  kind text not null,
  detail text,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists security_events_company_idx on security_events (company_id, created_at desc);
create index if not exists security_events_kind_idx on security_events (kind, created_at desc);
alter table security_events enable row level security;
revoke all on security_events from public, anon, authenticated;
grant select on security_events to authenticated;
drop policy if exists se_select on security_events;
create policy se_select on security_events for select to authenticated
  using (company_id = current_company_id() and (has_permission('users.manage') or has_permission('audit.view')));
-- failed sign-ins per email (the brute-force lockout looks back 15 minutes)
create index if not exists login_events_failed_email_idx on login_events (email, created_at desc) where event = 'sign_in_failed';   -- emails are stored lower-case

-- ───────────── 5. Private bucket: allowed file types ─────────────
-- The upload code already checks extension, declared type and file signature; the bucket now refuses anything else too
-- (PDF, images incl. WebP thumbnails, Word and Excel). The 15 MB size limit is unchanged.
update storage.buckets set allowed_mime_types = array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.ms-excel'
] where id = 'vault';
