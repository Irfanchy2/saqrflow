-- 0031: Working hours, overtime and payment notices for the Employee Portal.
-- Additive only: new columns (nullable), new / replaced functions and triggers. No existing row is deleted; open check-ins
-- from earlier days are closed at that day's end time the first time the auto-close runs.
--
--  • A fixed working day (Settings → Employee portal, default 08:00–18:00, the company's time zone). An employee checks in;
--    the day stops automatically at the end time if they do not check out.
--  • Overtime: after the working day ends, the employee taps "Start overtime"; it stops when they tap "Stop", or
--    automatically after the maximum (default 5 hours) if they forget. Overtime hours are recorded on the day.
--  • Advances and salary payments recorded by HR notify the employee in their portal (no amounts in the notice).

alter table attendance_records
  add column if not exists overtime_start_at timestamptz,
  add column if not exists overtime_end_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_overtime_order') then
    alter table attendance_records add constraint attendance_overtime_order
      check (overtime_end_at is null or (overtime_start_at is not null and overtime_end_at >= overtime_start_at)) not valid;
  end if;
end $$;
create index if not exists attendance_open_idx on attendance_records(company_id) where (check_in_at is not null and check_out_at is null) or (overtime_start_at is not null and overtime_end_at is null);

-- The company's working day and overtime limit (with defaults).
create or replace function attendance_settings(cid uuid, out tz text, out work_start time, out work_end time, out ot_max interval)
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select coalesce(c.timezone, 'Asia/Dubai') into tz from companies c where c.id = cid;
  tz := coalesce(tz, 'Asia/Dubai');
  v := approval_setting(cid, 'portal.work_start');
  work_start := case when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then (v #>> '{}')::time else time '08:00' end;
  v := approval_setting(cid, 'portal.work_end');
  work_end := case when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then (v #>> '{}')::time else time '18:00' end;
  if work_end <= work_start then work_end := time '18:00'; work_start := least(work_start, time '17:00'); end if;
  v := approval_setting(cid, 'portal.overtime_max_hours');
  ot_max := make_interval(mins => (case when jsonb_typeof(v) = 'number' and (v)::numeric > 0 and (v)::numeric <= 12 then round((v)::numeric * 60) else 300 end)::int);
end $$;
revoke all on function attendance_settings(uuid) from public, anon;
grant execute on function attendance_settings(uuid) to authenticated;

-- Closes what was left open: a check-in without check-out ends at that day's end time; overtime without a stop ends at the
-- maximum. Signed-in users close their own company only; the scheduled job (service role) closes every company.
create or replace function attendance_autoclose(p_company uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare cid uuid; n int := 0; m int; co record; st record;
begin
  if auth.uid() is not null then cid := current_company_id(); if cid is null then return 0; end if; else cid := p_company; end if;
  for co in select distinct r.company_id from attendance_records r
            where (cid is null or r.company_id = cid)
              and ((r.check_in_at is not null and r.check_out_at is null) or (r.overtime_start_at is not null and r.overtime_end_at is null)) loop
    select * into st from attendance_settings(co.company_id);
    update attendance_records r set check_out_at = greatest(r.check_in_at, (r.work_date + st.work_end) at time zone st.tz)
      where r.company_id = co.company_id and r.check_in_at is not null and r.check_out_at is null
        and now() >= (r.work_date + st.work_end) at time zone st.tz;
    get diagnostics m = row_count; n := n + m;
    update attendance_records r set overtime_end_at = r.overtime_start_at + st.ot_max,
        overtime_hours = round((extract(epoch from st.ot_max) / 3600.0)::numeric, 1)
      where r.company_id = co.company_id and r.overtime_start_at is not null and r.overtime_end_at is null
        and now() >= r.overtime_start_at + st.ot_max;
    get diagnostics m = row_count; n := n + m;
  end loop;
  return n;
end $$;
revoke all on function attendance_autoclose(uuid) from public, anon;
grant execute on function attendance_autoclose(uuid) to authenticated;

-- The employee's own buttons: check in / check out (the working day), start / stop overtime. Server time only.
create or replace function attendance_punch(p_kind text) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare emp uuid := my_employee_id(); cid uuid := current_company_id(); st record; d date; day_end timestamptz; r attendance_records; ot_end timestamptz;
begin
  if emp is null then raise exception 'This login is not linked to an employee record.'; end if;
  if coalesce(approval_setting(cid, 'portal.checkin'), 'false'::jsonb) <> 'true'::jsonb then raise exception 'Check-in is not turned on for your company.'; end if;
  if p_kind not in ('in','out','ot_start','ot_stop') then raise exception 'Unknown attendance action.'; end if;
  perform attendance_autoclose();
  select * into st from attendance_settings(cid);
  d := (now() at time zone st.tz)::date;
  day_end := (d + st.work_end) at time zone st.tz;

  if p_kind = 'ot_stop' then          -- the running overtime (it may have started before midnight)
    select * into r from attendance_records where employee_id = emp and overtime_start_at is not null and overtime_end_at is null
      order by work_date desc limit 1 for update;
    if not found then raise exception 'There is no overtime running.'; end if;
    ot_end := least(now(), r.overtime_start_at + st.ot_max);
    update attendance_records set overtime_end_at = ot_end,
        overtime_hours = round((extract(epoch from (ot_end - r.overtime_start_at)) / 3600.0)::numeric, 1)
      where id = r.id returning * into r;
    return r;
  end if;

  select * into r from attendance_records where employee_id = emp and work_date = d for update;
  if p_kind = 'in' then
    if found and r.check_in_at is not null then raise exception 'You already checked in today at %.', to_char(r.check_in_at at time zone st.tz, 'HH24:MI'); end if;
    if found and r.status in ('leave','holiday') then raise exception 'Today is recorded as %; ask HR to change it.', r.status; end if;
    if now() >= day_end then raise exception 'The working day ended at %. Ask HR to record today.', to_char(st.work_end, 'HH24:MI'); end if;
    insert into attendance_records(company_id, employee_id, work_date, status, check_in_at, source)
      values (cid, emp, d, 'present', now(), 'self')
      on conflict (employee_id, work_date) do update set check_in_at = now(), status = 'present', source = 'self'
      returning * into r;
  elsif p_kind = 'out' then
    if not found or r.check_in_at is null then raise exception 'Check in first.'; end if;
    if r.check_out_at is not null then raise exception 'Your day already ended at %.', to_char(r.check_out_at at time zone st.tz, 'HH24:MI'); end if;
    update attendance_records set check_out_at = least(now(), day_end) where id = r.id returning * into r;
  else  -- ot_start
    if not found or r.check_in_at is null then raise exception 'Check in first: overtime follows a working day.'; end if;
    if now() < day_end then raise exception 'Overtime starts after the working day ends at %.', to_char(st.work_end, 'HH24:MI'); end if;
    if r.overtime_start_at is not null then raise exception 'Overtime was already recorded today (from %).', to_char(r.overtime_start_at at time zone st.tz, 'HH24:MI'); end if;
    update attendance_records set check_out_at = coalesce(check_out_at, greatest(check_in_at, day_end)), overtime_start_at = now()
      where id = r.id returning * into r;
  end if;
  return r;
end $$;
revoke all on function attendance_punch(text) from public, anon;
grant execute on function attendance_punch(text) to authenticated;

-- Tell the employee when HR records an advance / deduction or pays their salary (amounts stay on the private Salary page).
create or replace function hr_payment_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  select e.user_id into u from employees e where e.id = new.employee_id;
  if u is null then return null; end if;
  if tg_table_name = 'employee_advances' then
    if tg_op <> 'INSERT' then return null; end if;
    insert into in_app_notifications(company_id, user_id, title, body, link, severity, dedupe_key)
      values (new.company_id, u, case new.kind when 'advance' then 'Salary advance paid to you' else 'Salary deduction recorded' end,
              'Recorded on ' || to_char(new.given_on, 'DD Mon YYYY') || '. Open Salary to see the amount.', '/me/salary', 'info', 'adv:' || new.id)
      on conflict do nothing;
  else
    if new.paid_on is null or (tg_op = 'UPDATE' and old.paid_on is not distinct from new.paid_on) then return null; end if;
    insert into in_app_notifications(company_id, user_id, title, body, link, severity, dedupe_key)
      values (new.company_id, u, 'Salary paid: ' || to_char(new.period, 'FMMonth YYYY'),
              'Paid on ' || to_char(new.paid_on, 'DD Mon YYYY') || '. Your payslip is in Salary.', '/me/salary', 'info', 'sal:' || new.id || ':' || new.paid_on)
      on conflict do nothing;
  end if;
  return null;
end $$;
revoke execute on function hr_payment_notify() from public, anon, authenticated;
drop trigger if exists hr_payment_notify_t on employee_advances;
create trigger hr_payment_notify_t after insert on employee_advances for each row execute function hr_payment_notify();
drop trigger if exists hr_payment_notify_t on salary_payments;
create trigger hr_payment_notify_t after insert or update of paid_on on salary_payments for each row execute function hr_payment_notify();
