# SaqrFlow — Architecture & Implementation Plan

## 1. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router, TS), server components + server actions | One deployable; data fetched server-side with the **user's** session so RLS always applies. |
| UI | Tailwind + hand-written shadcn-style primitives (`components/ui`) + lucide + recharts | No interactive CLI needed; same API/feel as shadcn so components can be swapped. |
| Data | Supabase Postgres, Auth, private Storage | RLS gives DB-level tenant isolation + permission enforcement. |
| Tenancy | `company_id` on every row; `current_company_id()` / `has_permission()` SQL helpers used by every policy | Multi-company SaaS-ready from day one. |
| Sensitive data | Salary lives in a separate table (`employee_compensation`, `salary_payments`) with its own RLS (`salary.view`). Employee docs require `employees.view_sensitive`. | Column-level secrecy enforced by the database, not by hiding UI. |
| Files | Private bucket `vault`, path `{company_id}/{document_id}/v{n}-{file}`; storage RLS by company; downloads only through `/api/documents/[id]/download` which checks permission, writes an access log and returns a 60 s signed URL. | No public URLs. |
| Versioning | `document_versions` is insert-only (no UPDATE/DELETE policy). Replacing a file adds a version. Delete = soft delete (`deleted_at`). | Old files never disappear automatically. |
| Reminders | **Idempotent fan-out + durable queue.** A cron endpoint computes due `(source, offset, recipient, channel)` tuples and `INSERT … ON CONFLICT DO NOTHING` into `notification_logs` keyed by a unique `dedupe_key`. A dispatcher claims rows (`FOR UPDATE SKIP LOCKED` via RPC) and sends with exponential-backoff retry; permanent failure falls back to e-mail. | Re-running the cron (or two overlapping runs) can never double-send. State is in Postgres, so it survives restarts. |
| WhatsApp | Meta Cloud API, template messages only for business-initiated sends; HMAC-verified webhook for delivery receipts; **sandbox mode** (default when credentials absent) records `sandbox` status and never claims delivery. | Honest by construction. |
| Secrets | Env vars; integration tokens entered in Settings are AES-256-GCM encrypted with `SETTINGS_ENCRYPTION_KEY` and stored in `integration_secrets` (no client-readable policy). | Never in code or client. |
| AI | Provider abstraction (`lib/ai`) — Phase 3, not implemented yet. | Out of Phase 1 scope. |

## 2. Data model (see `supabase/migrations`)

```
companies 1─* profiles(role) ─* audit_logs
companies 1─* document_categories
companies 1─* documents(owner_type: company|employee|project|asset|vault)
                documents 1─* document_versions (insert-only)
                documents 1─* document_renewals
                documents 1─* document_access_logs
companies 1─* employees 1─1 employee_compensation   (salary.view)
                        1─* salary_payments         (salary.view)
                        1─* leave_records, attendance_records, employee_advances
companies 1─* banks, customers, suppliers
companies 1─* cheques ─> bank, customer|supplier, (invoice|project)
companies 1─* projects, invoices, payments, assets   (schema ready; UI = Phase 2)
companies 1─* reminders (custom events)
companies 1─* notification_recipients 1─* notification_logs (unique dedupe_key)
companies 1─* in_app_notifications, app_settings, integration_secrets
role_permissions(role, permission)  — global defaults
```

## 3. Security controls

* Auth: Supabase Auth (email+password, optional TOTP MFA enrolment via Supabase MFA API in Settings).
* RBAC: 7 roles × 14 permissions in `role_permissions`, mirrored in `lib/permissions.ts` for UI gating and server-action pre-checks. **The DB is the source of truth** (RLS calls `has_permission`).
* RLS on every table; `audit_logs` append-only (trigger-written, no client INSERT/UPDATE/DELETE).
* Server-side validation with zod; file type/size allow-list (`lib/files.ts`), SHA-256 duplicate detection.
* Rate limiting: in-memory token bucket in middleware for auth & API routes (swap for Redis/Upstash when running multiple instances — flagged in docs).
* Security headers (CSP, HSTS, X-Frame-Options, etc.) in `next.config.mjs`.
* WhatsApp payloads exclude ID numbers / sensitive data (`lib/whatsapp/templates.ts` only accepts a whitelisted shape).
* No banking credentials are ever collected; cheque module is a **tracker** — clearing is a manual confirmation.

## 4. Phases & status

See the table in `README.md` ("Implemented vs planned").
