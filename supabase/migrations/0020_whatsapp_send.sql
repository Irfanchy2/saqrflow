-- 0020: WhatsApp Business messages to customers and employees (documents with PDF, statements, reminders, updates).
-- Reuses the notification queue: a message is a notification_logs row (channel whatsapp) addressed to a phone number of a
-- customer / supplier / employee instead of an internal recipient. Same dispatcher, retries, delivery receipts and log.
-- Additive only.

alter table notification_logs add column if not exists to_number text check (to_number is null or to_number ~ '^\+[1-9][0-9]{7,14}$');
alter table notification_logs add column if not exists party_type text check (party_type is null or party_type in ('customer','supplier','employee'));
alter table notification_logs add column if not exists party_id uuid;
alter table notification_logs add column if not exists kind text check (kind is null or kind ~ '^[a-z_]{3,40}$');
alter table notification_logs add column if not exists record_type text check (record_type is null or record_type ~ '^[a-z_]{3,40}$');
alter table notification_logs add column if not exists record_id uuid;
alter table notification_logs add column if not exists body_text text check (body_text is null or length(body_text) <= 1100);
alter table notification_logs add column if not exists attachment_path text check (attachment_path is null or length(attachment_path) <= 300);
alter table notification_logs add column if not exists attachment_name text check (attachment_name is null or length(attachment_name) <= 200);
alter table notification_logs add column if not exists freeform boolean not null default false;
alter table notification_logs add column if not exists sent_by uuid references profiles(id) on delete set null;
create index if not exists notification_logs_party_idx on notification_logs(company_id, party_type, party_id, created_at desc) where party_id is not null;

-- history under a customer / supplier / employee: visible to the people who can see that kind of record
create policy nl_party_select on notification_logs for select to authenticated using (
  company_id = current_company_id() and party_id is not null and (
    (party_type in ('customer','supplier') and has_permission('finance.view'))
    or (party_type = 'employee' and kind = 'payslip' and has_permission('salary.view'))
    or (party_type = 'employee' and kind <> 'payslip' and has_permission('employees.view_sensitive'))));
-- and nobody else: the reminder-log policy (reminders.create) must not reveal payslips or statements to other roles
create policy nl_party_restrict on notification_logs as restrictive for select to authenticated using (
  party_id is null
  or (party_type in ('customer','supplier') and has_permission('finance.view'))
  or (party_type = 'employee' and kind = 'payslip' and has_permission('salary.view'))
  or (party_type = 'employee' and kind <> 'payslip' and has_permission('employees.view_sensitive')));

-- WhatsApp contacts: last inbound message (opens the 24-hour customer-service window) and STOP / START consent, per number
create table if not exists whatsapp_contacts (
  company_id uuid not null references companies(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  last_inbound_at timestamptz,
  opted_out_at timestamptz,
  opted_in_at timestamptz,
  primary key (company_id, phone)
);
alter table whatsapp_contacts enable row level security;
create policy wc_select on whatsapp_contacts for select to authenticated using (company_id = current_company_id() and has_permission('records.edit'));
