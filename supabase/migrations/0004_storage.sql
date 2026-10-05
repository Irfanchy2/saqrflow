-- Private bucket. Authenticated users may only INSERT into their own company folder; nobody can
-- read/list/update/delete directly. Reads happen via short-lived signed URLs minted server-side
-- (service role) after the app has verified document permission through RLS.
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 15728640)
on conflict (id) do update set public = false;

create policy vault_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'vault'
  and (storage.foldername(name))[1] = current_company_id()::text
  and has_permission('documents.upload'));
