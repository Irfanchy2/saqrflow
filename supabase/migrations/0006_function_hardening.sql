-- Supabase advisor findings: trigger functions must not be callable via /rest/v1/rpc; pin search_path; anon needs no functions.
alter function cheque_transition_ok(text,text,text) set search_path = public;
alter function touch_updated_at() set search_path = public;
alter function apply_standard_rls(regclass,text,text) set search_path = public;

revoke execute on function audit_row(), cheques_guard(), documents_guard(), profiles_guard(), touch_updated_at() from public, anon, authenticated;
revoke execute on function apply_standard_rls(regclass,text,text) from public, anon, authenticated;
-- RLS helpers are evaluated as the signed-in user, so `authenticated` keeps EXECUTE; anonymous callers lose it.
revoke execute on function current_company_id(), has_permission(text), is_own_employee(uuid), can_view_document(text,uuid) from public, anon;
grant execute on function current_company_id(), has_permission(text), is_own_employee(uuid), can_view_document(text,uuid) to authenticated, service_role;
