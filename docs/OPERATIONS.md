# Operations

## Backups & restore
* Enable Supabase daily backups (Pro: PITR). Storage objects are **not** in database backups — mirror the `vault` bucket (e.g. `rclone sync` from the S3-compatible endpoint) on a schedule.
* Logical backup: `pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner -f saqrflow-$(date +%F).dump`
* **Test the restore quarterly:** create a scratch Supabase/Postgres, `createdb saqrflow_restore`, apply `tests/db/supabase_stub.sql` only if not on Supabase, `pg_restore --no-owner -d saqrflow_restore dump`, then run `select count(*) from documents, employees, cheques;` and open a few documents through a staging app. Record the date and result.
* The migration + RLS suite (`npm run test:db`) rebuilds the whole schema from scratch in seconds — use it to validate any restore target's policies.

## Retention & deletion
* Documents are soft-deleted; versions are immutable. Permanent purge is intentionally manual (service-role SQL by an authorised admin, with a recorded reason) to honour retention duties. Define periods per document class with counsel.
* Audit logs are append-only. Account/data export: CSV exports + `pg_dump` filtered by `company_id`.

## Monitoring checklist
* `/api/health` uptime; alert if `/api/cron/reminders` has no `notification_logs` activity for >1 h; alert on `notification_logs.status='failed'` growth; review `audit_logs` for `EXPORT` events.

## Incident quick refs
* WhatsApp failing: Smart Reminders → Delivery log shows Meta error codes; permanent failures fall back to email when enabled. Retry button re-queues.
* Revoke access: Users → Deactivate (effective immediately — `current_company_id()` ignores inactive profiles); rotate tokens in Settings.
