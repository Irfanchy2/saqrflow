-- Smart Document Inbox (additive only: no existing table is dropped or rewritten).
-- Reuses documents / document_versions / document_categories. Review queue = document_inbox.status.

-- documents: allow archiving; remember which inbox upload produced a document
alter table documents drop constraint if exists documents_status_check;
alter table documents add constraint documents_status_check check (status in ('active','renewal_in_progress','cancelled','archived'));
alter table documents add column if not exists source_inbox_id uuid;

create table document_inbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  uploaded_by uuid references profiles(id) on delete set null,
  source text not null default 'upload' check (source in ('upload','mobile','whatsapp','email','drive','scanner')),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  status text not null default 'processing'
    check (status in ('processing','ready','needs_review','duplicate','filed','rejected','failed')),
  review_reasons text[] not null default '{}',
  doc_type text,                         -- catalog key chosen by the classifier (or the reviewer)
  confidence numeric(4,3),               -- overall confidence 0..1
  suggestion jsonb not null default '{}'::jsonb,   -- destination + matched owner + duplicate candidates
  filed_document_id uuid references documents(id) on delete set null,
  filed_by uuid references profiles(id),
  filed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index document_inbox_company_status_idx on document_inbox(company_id, status, created_at desc);
create index document_inbox_hash_idx on document_inbox(company_id, sha256);
alter table documents add constraint documents_source_inbox_fk foreign key (source_inbox_id) references document_inbox(id) on delete set null;

create table document_extractions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  inbox_id uuid not null references document_inbox(id) on delete cascade,
  engine text not null check (engine in ('rules','claude')),
  engine_version text not null,
  doc_type text not null,
  doc_type_confidence numeric(4,3) not null,
  fields jsonb not null default '{}'::jsonb,       -- { key: { value, confidence, source } }
  text_excerpt text,                               -- first 20k chars of extracted text (sensitive: same RLS as inbox)
  created_at timestamptz not null default now()
);
create index document_extractions_inbox_idx on document_extractions(inbox_id, created_at desc);

-- one stored file, many places: link a document to any record without copying it
create table document_relationships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  related_type text not null check (related_type in ('company','employee','customer','supplier','project','vehicle','asset','invoice','quotation','delivery_note','purchase_order','cheque')),
  related_id uuid,
  role text,                                       -- e.g. 'invoice', 'delivery_note', 'attachment'
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, related_type, related_id)
);
create index document_relationships_related_idx on document_relationships(company_id, related_type, related_id);

-- corrections made by reviewers, applied to future classifications (local learning; nothing leaves the database)
create table document_type_mappings (
  company_id uuid not null references companies(id) on delete cascade,
  doc_type text not null,
  category_id uuid not null references document_categories(id) on delete cascade,
  times_used int not null default 1,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, doc_type)
);

-- ── RLS ──
alter table document_inbox enable row level security;
-- unfiled uploads may contain passports / IDs: visible to the uploader and to roles allowed to see employee identity documents
create policy inbox_select on document_inbox for select to authenticated using (
  company_id = current_company_id() and (uploaded_by = auth.uid() or has_permission('employees.view_sensitive')));
create policy inbox_insert on document_inbox for insert to authenticated with check (
  company_id = current_company_id() and uploaded_by = auth.uid() and has_permission('documents.upload'));
create policy inbox_update on document_inbox for update to authenticated using (
  company_id = current_company_id() and has_permission('documents.upload')
  and (uploaded_by = auth.uid() or has_permission('employees.view_sensitive')))
  with check (company_id = current_company_id());
-- no DELETE policy: rejected uploads keep their audit trail

alter table document_extractions enable row level security;
create policy dx_select on document_extractions for select to authenticated using (
  company_id = current_company_id() and exists (select 1 from document_inbox i where i.id = inbox_id));
create policy dx_insert on document_extractions for insert to authenticated with check (
  company_id = current_company_id() and has_permission('documents.upload')
  and exists (select 1 from document_inbox i where i.id = inbox_id));

alter table document_relationships enable row level security;
create policy drel_select on document_relationships for select to authenticated using (
  company_id = current_company_id() and exists (select 1 from documents d where d.id = document_id));
create policy drel_insert on document_relationships for insert to authenticated with check (
  company_id = current_company_id() and has_permission('documents.upload')
  and exists (select 1 from documents d where d.id = document_id));
create policy drel_delete on document_relationships for delete to authenticated using (
  company_id = current_company_id() and has_permission('records.delete'));

alter table document_type_mappings enable row level security;
create policy dtm_select on document_type_mappings for select to authenticated using (company_id = current_company_id());
create policy dtm_insert on document_type_mappings for insert to authenticated with check (company_id = current_company_id() and has_permission('documents.upload'));
create policy dtm_update on document_type_mappings for update to authenticated using (company_id = current_company_id() and has_permission('documents.upload')) with check (company_id = current_company_id());

-- audit: who uploaded / filed / rejected (extractions are NOT audited: they hold document text)
create trigger audit_document_inbox after insert or update on document_inbox for each row execute function audit_row();
create trigger audit_document_relationships after insert or delete on document_relationships for each row execute function audit_row();
