-- AI document reader: OCR / AI provider tracking, processing logs, usage counters. Additive only.
-- Reuses document_inbox, document_extractions, document_relationships, document_versions, notification_logs,
-- app_settings (provider choice) and integration_secrets (encrypted API keys).

-- ───────────── inbox: full processing life-cycle ─────────────
alter table document_inbox drop constraint if exists document_inbox_status_check;
alter table document_inbox add constraint document_inbox_status_check check (status in
  ('uploaded','processing','ocr_complete','classification_complete','ready','needs_review','duplicate','filed','rejected','failed'));
alter table document_inbox
  add column if not exists ocr_provider text,          -- which engine produced the text (text_layer / ocrspace / google_vision / tesseract)
  add column if not exists ai_provider text,           -- which engine classified (rules / gemini / claude)
  add column if not exists processing_ms int,
  add column if not exists attempts int not null default 0;

alter table document_extractions drop constraint if exists document_extractions_engine_check;
alter table document_extractions add constraint document_extractions_engine_check check (engine in ('rules','claude','gemini'));
alter table document_extractions
  add column if not exists ocr_provider text,
  add column if not exists ocr_language text,
  add column if not exists ocr_ms int,
  add column if not exists ai_ms int;

alter table document_relationships drop constraint if exists document_relationships_related_type_check;
alter table document_relationships add constraint document_relationships_related_type_check check (related_type in
  ('company','employee','customer','supplier','project','vehicle','asset','invoice','quotation','delivery_note','purchase_order','cheque','payment'));

-- ───────────── provider call logs (no document text, no keys) ─────────────
create table ocr_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  inbox_id uuid references document_inbox(id) on delete set null,
  provider text not null,                              -- text_layer | ocrspace | google_vision | tesseract
  ok boolean not null,
  language text,
  chars int not null default 0,
  pages int,
  processing_ms int,
  error text,                                          -- provider error message (truncated, never contains the API key)
  cached boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index ocr_logs_company_idx on ocr_logs(company_id, created_at desc);

create table ai_processing_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  inbox_id uuid references document_inbox(id) on delete set null,
  provider text not null,                              -- gemini | claude
  model text,
  purpose text not null check (purpose in ('classify','search','test')),
  ok boolean not null,
  input_chars int not null default 0,
  redacted boolean not null default false,             -- ID numbers removed before sending
  processing_ms int,
  error text,
  cached boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index ai_logs_company_idx on ai_processing_logs(company_id, created_at desc);

do $$ declare t text; begin
  foreach t in array array['ocr_logs','ai_processing_logs'] loop
    execute format('alter table %I enable row level security', t);
    -- read: admins (usage / cost screen) and whoever can see the related upload
    execute format($p$create policy %1$s_select on %1$I for select to authenticated using (
      company_id = current_company_id() and (has_permission('settings.manage')
        or (inbox_id is not null and exists (select 1 from document_inbox i where i.id = inbox_id))))$p$, t);
    execute format($p$create policy %1$s_insert on %1$I for insert to authenticated with check (
      company_id = current_company_id() and created_by = auth.uid() and (has_permission('documents.upload') or has_permission('settings.manage')))$p$, t);
    -- append-only: no update / delete policies
  end loop;
end $$;

-- ───────────── usage counters (cost control) ─────────────
create view ai_usage_daily with (security_invoker = true) as
  select company_id, (created_at at time zone 'Asia/Dubai')::date as day, 'ocr'::text as kind, provider,
         count(*) filter (where not cached)::int as calls, count(*) filter (where not ok)::int as failures,
         count(*) filter (where cached)::int as cache_hits, coalesce(sum(chars), 0)::bigint as volume
  from ocr_logs group by 1, 2, 4
  union all
  select company_id, (created_at at time zone 'Asia/Dubai')::date, 'ai', provider,
         count(*) filter (where not cached)::int, count(*) filter (where not ok)::int,
         count(*) filter (where cached)::int, coalesce(sum(input_chars), 0)::bigint
  from ai_processing_logs group by 1, 2, 4;
