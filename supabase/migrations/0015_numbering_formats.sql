-- 0015: editable document numbering — separator after the prefix and a year format (YYYY / YY), with new defaults:
--   Quotation AS-002600/2026 · Invoice INV-610 · Delivery note DL-1300
-- Additive only: new columns with defaults, functions replaced in place. Issued document numbers are never rewritten.

alter table document_number_formats add column if not exists number_separator text not null default '' check (number_separator in ('', '-', '/', '.'));
alter table document_number_formats add column if not exists year_format text not null default 'yyyy' check (year_format in ('yyyy', 'yy'));

-- prefix + separator + fixed digits + running number (min digits) + [year separator + year]
create or replace function format_document_number_v2(p_prefix text, p_nsep text, p_fixed text, p_pad int, p_seq bigint, p_ysep text, p_yfmt text, p_year int)
returns text language sql immutable set search_path = public as $$
  select p_prefix || coalesce(p_nsep, '') || p_fixed || lpad(p_seq::text, greatest(p_pad, length(p_seq::text)), '0')
         || case when p_year is null then '' else p_ysep || case when p_yfmt = 'yy' then lpad((p_year % 100)::text, 2, '0') else p_year::text end end
$$;

create or replace function next_document_number(p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare cid uuid := current_company_id(); yr int; n bigint; prefix text; f document_number_formats; num text;
begin
  if cid is null or not has_permission('records.edit') then raise exception 'insufficient privilege'; end if;
  prefix := case p_doc_type when 'quotation' then 'QTN' when 'invoice' then 'INV' when 'delivery_note' then 'DN'
    when 'purchase_order' then 'PO' when 'credit_note' then 'CN' when 'receipt' then 'RCT' when 'project' then 'PRJ'
    when 'lead' then 'LD' when 'site_visit' then 'SV' when 'work_order' then 'WO' when 'site_report' then 'DSR' else null end;
  if prefix is null then raise exception 'unknown document type %', p_doc_type; end if;
  select extract(year from (now() at time zone c.timezone))::int into yr from companies c where c.id = cid;

  -- custom format: the row lock serialises concurrent callers, and any number already in use is skipped → never a duplicate
  select * into f from document_number_formats where company_id = cid and doc_type = p_doc_type for update;
  if found then
    if f.yearly_reset and f.last_year is not null and f.last_year <> yr then f.next_seq := f.reset_to; end if;
    loop
      num := format_document_number_v2(f.prefix, f.number_separator, f.fixed_digits, f.seq_pad, f.next_seq, f.year_separator, f.year_format, case when f.include_year then yr end);
      f.next_seq := f.next_seq + 1;
      exit when not (case p_doc_type
        when 'project' then exists (select 1 from projects p where p.company_id = cid and p.code = num)
        when 'lead' then exists (select 1 from leads x where x.company_id = cid and x.number = num)
        when 'site_visit' then exists (select 1 from site_visits x where x.company_id = cid and x.number = num)
        when 'work_order' then exists (select 1 from work_orders x where x.company_id = cid and x.number = num)
        when 'site_report' then exists (select 1 from daily_site_reports x where x.company_id = cid and x.number = num)
        else exists (select 1 from invoices i where i.company_id = cid and i.doc_type = p_doc_type and i.number = num) end);
    end loop;
    update document_number_formats set next_seq = f.next_seq, last_year = yr where company_id = cid and doc_type = p_doc_type;
    return num;
  end if;

  insert into document_counters(company_id, doc_type, year, last) values (cid, p_doc_type, yr, 1)
    on conflict (company_id, doc_type, year) do update set last = document_counters.last + 1
    returning last into n;
  return prefix || '-' || yr || '-' || lpad(n::text, 4, '0');
end $$;
revoke all on function next_document_number(text) from public, anon;
grant execute on function next_document_number(text) to authenticated;

-- new companies: AS-002600/2026, INV-610, DL-1300
create or replace function seed_number_formats() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into document_number_formats(company_id, doc_type, prefix, number_separator, fixed_digits, seq_pad, next_seq, year_separator, year_format, include_year) values
    (new.id, 'quotation', 'AS', '-', '', 6, 2600, '/', 'yyyy', true),
    (new.id, 'invoice', 'INV', '-', '', 1, 610, '/', 'yyyy', false),
    (new.id, 'delivery_note', 'DL', '-', '', 1, 1300, '/', 'yyyy', false)
  on conflict do nothing;
  return new;
end $$;
revoke execute on function seed_number_formats() from public, anon, authenticated;

-- existing companies: quotations move to AS-00…/YYYY and keep counting from where they are (never back to a used number);
-- invoices and delivery notes get the new defaults unless a company already set its own. Issued numbers stay as they are.
update document_number_formats set prefix = 'AS', number_separator = '-', fixed_digits = '', seq_pad = 6, year_separator = '/', year_format = 'yyyy', include_year = true,
    next_seq = greatest(next_seq, 2600), updated_at = now()
  where doc_type = 'quotation' and prefix in ('AS', 'AS-');
insert into document_number_formats(company_id, doc_type, prefix, number_separator, fixed_digits, seq_pad, next_seq, year_separator, year_format, include_year)
  select id, 'quotation', 'AS', '-', '', 6, 2600, '/', 'yyyy', true from companies
  union all select id, 'invoice', 'INV', '-', '', 1, 610, '/', 'yyyy', false from companies
  union all select id, 'delivery_note', 'DL', '-', '', 1, 1300, '/', 'yyyy', false from companies
  on conflict do nothing;
