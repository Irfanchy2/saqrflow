-- 0039: green PAID stamp on fully paid tax invoices.
-- Additive only: two new nullable / defaulted columns. No existing row, invoice, payment or company detail is changed.
--   companies.name_ar        registered company name in Arabic (top arc of the stamp; Settings → Company)
--   invoices.show_paid_stamp per-invoice switch (default on): "Remove PAID stamp" on an invoice turns it off
-- Safe to run more than once.

alter table public.companies add column if not exists name_ar text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_name_ar_len') then
    alter table public.companies add constraint companies_name_ar_len check (name_ar is null or char_length(name_ar) between 2 and 200);
  end if;
end $$;

-- constant default: Postgres adds this without rewriting the table (existing invoices read as "show")
alter table public.invoices add column if not exists show_paid_stamp boolean not null default true;

comment on column public.companies.name_ar is 'Registered company name in Arabic, shown on the PAID stamp.';
comment on column public.invoices.show_paid_stamp is 'Show the PAID stamp when this tax invoice is fully paid (per-invoice switch).';
