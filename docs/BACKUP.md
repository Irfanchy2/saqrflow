# Backup & restore

SaqrFlow keeps no data on the web server. Everything lives in your Supabase project.

| What | Where | Backed up by |
|---|---|---|
| Records (customers, quotations, invoices, payments, employees, cheques, assets …) | Supabase Postgres | Supabase scheduled backups (retention depends on your plan; Point-in-Time Recovery is an add-on) |
| Uploaded files (documents, letterhead, stamp, receipts) | Supabase Storage bucket `vault` (private) | **Not** included in database backups — see “Files” below |
| Change history | `audit_logs`, `sales_doc_revisions` tables | with the database |

## Check what you have
Supabase dashboard → your project → **Database → Backups**. Free projects have no downloadable scheduled backups; Pro keeps daily backups (7 days) and supports PITR.

## Your own off-site copy
- **Lists:** Settings → Data & backup → download the Excel exports (customers, invoices, payments, employees, cheques, expiry report …). Every export is audit-logged.
- **Full database:** `pg_dump "$DATABASE_URL" -Fc -f saqrflow-$(date +%F).dump` (connection string from Supabase → Project settings → Database). Keep it encrypted.
- **Files:** `supabase storage cp -r ss:///vault ./vault-backup --experimental` (Supabase CLI) or the Storage API with the service key, from a trusted machine only.

## Restore
1. **One record deleted** → Settings → Trash → Restore (soft delete keeps everything).
2. **Wrong edit** → Audit log shows previous values; sales documents keep every revision (Revisions panel).
3. **Whole database** → Supabase dashboard → Backups → Restore (overwrites the project — do it on a branch / new project first and verify).
4. **From your own dump** → `pg_restore --clean --no-owner -d "$NEW_DATABASE_URL" saqrflow-YYYY-MM-DD.dump`, then point the app's `NEXT_PUBLIC_SUPABASE_URL` / keys at the restored project.

Never commit dumps, service keys or `.env` files to Git.
