-- Onboarding + queue RPCs.

-- A freshly signed-up user creates a company and becomes its owner. Idempotent: one company per user (v1).
create or replace function create_company_with_owner(p_company_name text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from profiles where id = uid) then raise exception 'user already belongs to a company'; end if;
  if length(trim(coalesce(p_company_name,''))) < 2 then raise exception 'company name too short'; end if;
  insert into companies(name) values (trim(p_company_name)) returning id into cid;
  insert into profiles(id, company_id, full_name, role) values (uid, cid, trim(p_full_name), 'company_owner');

  insert into document_categories(company_id, scope, name, is_system)
  select cid, 'company', n, true from unnest(array[
    'Trade License','Establishment Card','Chamber of Commerce Certificate','Corporate Tax Registration',
    'VAT Registration Certificate','Company Insurance','Office & Workshop Tenancy','Ejari / Tenancy Contract',
    'Government Permit','Municipality Approval','Bank Letter','Company Contract','Supplier Agreement',
    'Certificate / Approval','Other']) n;
  insert into document_categories(company_id, scope, name, is_system)
  select cid, 'employee', n, true from unnest(array[
    'Passport','Emirates ID','Residence Visa','Work Permit','Labour Contract','Medical Insurance',
    'Safety / Training Certificate','Other Certificate']) n;
  insert into notification_recipients(company_id, user_id, name, channels, receives_digest)
  values (cid, uid, trim(p_full_name), array['in_app'], true);
  return cid;
end $$;
revoke all on function create_company_with_owner(text,text) from public, anon;
grant execute on function create_company_with_owner(text,text) to authenticated;

-- Claim a batch of due notifications for the dispatcher (safe under concurrent workers).
create or replace function claim_notifications(p_batch int default 50)
returns setof notification_logs language plpgsql security definer set search_path = public as $$
begin
  return query
  update notification_logs n
     set status = 'sending', claimed_at = now()
   where n.id in (
     select id from notification_logs
      where (status in ('queued','retry') and next_attempt_at <= now())
         or (status = 'sending' and claimed_at < now() - interval '10 minutes')   -- recover crashed workers
      order by next_attempt_at
      limit p_batch for update skip locked)
  returning n.*;
end $$;
revoke all on function claim_notifications(int) from public, anon, authenticated;
grant execute on function claim_notifications(int) to service_role;
