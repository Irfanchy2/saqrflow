# Averiqo Business OS

Sales, projects, documents, employees, vehicles, assets, cheques and **automatic renewal reminders (WhatsApp / email / in-app)** for UAE businesses.
Averiqo is the software; the company using it (e.g. AL SAQR AL AHMAR WELDING AND BLACKSMITH) keeps its own legal identity on quotations, invoices and letterheads.
First deployed for Al Saqr; architected multi-tenant (every row carries `company_id`, enforced by Postgres RLS).

Stack: Next.js 15 (App Router, TS) · Tailwind · Supabase (Postgres, Auth, private Storage, RLS) · Meta WhatsApp Cloud API · Resend (email) · Vercel Cron.
Architecture and decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Operations: [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Implemented vs planned (honest status)

| Area | Status |
|---|---|
| Auth (email+password), onboarding wizard, optional TOTP MFA, session cookies | ✅ implemented |
| Roles & 14 permissions, enforced in RLS (+ UI/server pre-checks), audit log, user invite/roles | ✅ |
| Dashboard (stats, charts, clickable priority alerts, recent activity) | ✅ incl. receivables and active-projects cards |
| Company documents: categories (custom), upload, preview, signed download, versions, renewals, soft delete/restore, access log | ✅ |
| Employees: profile, documents + compliance checklist, salary (separate RLS), advances, leave, photo | ✅ (attendance, onboarding checklists, accommodation records, WPS export: schema only / planned) |
| Document Vault: drag-and-drop bulk upload, filters, duplicate (SHA-256) detection, recycle bin | ✅ (folder tree UI, bulk export zip: planned) |
| Cheques: all types/statuses, validated state machine, manual clearing confirmation, summaries, monthly calendar, CSV | ✅ |
| Reminders: scheduler endpoint, idempotent fan-out, retries w/ backoff, email fallback, quiet hours, opt-in/out, webhook receipts, logs, test sends, daily digest, custom + recurring reminders | ✅ — **WhatsApp runs in SANDBOX until you add Meta credentials** |
| Calendar, global search, CSV exports | ✅ |
| Clients & Suppliers directory | ✅ |
| Arabic (RTL) / Bengali | 🟡 navigation & chrome only |
| **Sales & invoices**: quotations, tax invoices (VAT per line), delivery notes in your own letterhead/stamp/signature, live A4 builder, auto-numbering, convert QTN → INV → DN, PDF download + print, save PDF to the Vault, partial payments (DB-enforced, no overpayment), automatic paid/overdue status, receivables ageing, invoice reminders — see [`docs/SALES_PROJECTS.md`](docs/SALES_PROJECTS.md) | ✅ (not certified e-invoicing software) |
| **Projects**: contract value, client, fabrication & site progress, milestones (with reminders), costs by category, profit & margin, project files, linked quotations/invoices | ✅ |
| Customer profile (documents, invoices, payments, cheques, projects) | ✅ |
| **Vehicles & Assets**: vehicles (plate, VIN, mileage, Mulkiya, insurance, inspection, km-based service) and equipment (code, serial, brand, condition, warranty, location), profile with documents, maintenance, expenses, assignment history, reminders and timeline; statuses Active / Assigned / Available / Maintenance / Repair / Out of service / Retired; archive/restore; CSV + Excel export | ✅ |
| **Reports & Analytics**: period filters (today, week, month, quarter, year, custom), sales, quotations & conversion, receivables ageing, projects (profit only where costs are recorded), document & employee compliance, vehicles & assets, cheques. One server-side aggregation (`report_summary`, RLS-scoped); every KPI drills down to the matching list; CSV / Excel / PDF / print exports, audit-logged | ✅ |
| **Document numbering**: quotations as `AS0025180/2026` (prefix, start number and other document types configurable in Settings → Document numbering; never duplicates) | ✅ |
| **Connected sales workflow**: customer → quotation (statuses, revisions, follow-ups, optional manager approval) → partial delivery notes → invoice → payments / cleared cheques / credit notes → customer ledger & statement (print + PDF). Autosave, unsaved-changes guard, double-submit protection, edit-conflict detection, integer-fils money maths, VAT categories and discounts | ✅ |
| **Expenses** (with receipt OCR suggestions), **project profitability**, team, photos (thumbnails), **Products & Services** catalog, terms templates | ✅ |
| **Trash & restore**, **audit log**, global search, notification centre, Excel/CSV import & export — see [`docs/BACKUP.md`](docs/BACKUP.md) for backups | ✅ |
| Weekly report e-mail, public customer quotation link | ⏳ planned |
| **Smart Document Inbox**: upload anything → classified (22 UAE doc types), matched to company/employee/customer/vehicle, duplicate & renewal detection, confirm-to-file, versions, auto reminders, timelines — see [`docs/SMART_INBOX.md`](docs/SMART_INBOX.md) | ✅ OCR provider chain (Google Cloud Vision → OCR.Space → local Tesseract) + Gemini classification with strict JSON and server-side validation — see [`docs/AI_DOCUMENT_READER.md`](docs/AI_DOCUMENT_READER.md) (needs your OCR / Gemini keys) |
| AI Search (natural-language questions, permission-aware) | ✅ (rules without a key; Gemini understands free-form questions) |
| Accounting-software sync | ⏳ planned |
| Multi-company onboarding UI, billing, super-admin console | ⏳ planned (tenancy itself is already enforced) |
| Malware scanning | ⏳ hook point only (`lib/doc-upload.ts`); type/size/magic-byte checks are active |

## Quick start

```bash
cp .env.example .env.local           # fill in values (see below)
npm install
# 1. Create a Supabase project → SQL editor → run supabase/migrations/0001…0013 in order
#    (or: supabase db push). 0004 creates the private "vault" bucket.
npm run dev                          # http://localhost:3000 → Sign up → create company
```

Supabase settings: Auth → disable "public sign-ups" after you create your own account if you want invite-only; set Site URL to `NEXT_PUBLIC_APP_URL`.

## Tests (all runnable here, no cloud needed)

```bash
npm test            # 130 unit tests: sales maths & PDF, OCR + validators, reminder dates, timezone, dedupe, retry/backoff, quiet hours, cheques, files, crypto, webhook signatures
npm run test:db     # 48 tests on a real Postgres: migrations, RLS, tenant isolation, salary secrecy, immutable versions, cheque machine, queue, storage policy, TS↔SQL parity
npm run test:e2e    # 150+ browser checks: real Next server + real PostgREST + Postgres RLS (auth/storage faked), see scripts/e2e.sh
```
The e2e harness replaces only Supabase **Auth and Storage** with a small local stand-in (`tests/e2e/fake-supabase.mjs`); everything else (SQL, RLS, PostgREST queries, Next.js, server actions, UI) is real. It does **not** exercise real Supabase Auth/Storage, real WhatsApp or real email — those need your credentials (below).

## WhatsApp Cloud API setup

1. Meta Business Manager → create/verify a **WhatsApp Business Account** and add a phone number.
2. Create a **System User** with `whatsapp_business_messaging` + `whatsapp_business_management`, generate a **permanent token**.
3. In Averiqo → Settings → WhatsApp: enter *Phone number ID* and token (stored AES-256-GCM encrypted; needs `SETTINGS_ENCRYPTION_KEY`) — or set `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` env vars.
4. Message Templates → create the four templates listed in Settings (names `saqrflow_document_reminder`, `saqrflow_payment_alert`, `saqrflow_daily_summary`, `saqrflow_test_message`; category *Utility*, language *en*, body text exactly as shown). Business-initiated messages **require approved templates**.
5. Webhook: callback `https://<app>/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`; set `WHATSAPP_APP_SECRET` (App → Settings → Basic) so signatures can be verified.
6. Add recipients (Smart Reminders → Recipients) and **record their opt-in**. Until credentials exist the UI shows `WhatsApp: SANDBOX` and logs `sandbox / not sent`.

Costs: Meta bills per conversation/message by category and country; enter your price in Settings to see an *estimate* in the delivery log. Verify current pricing with Meta.

## Scheduler

`GET|POST /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET`. It is idempotent (unique `dedupe_key`), so run it often (it also drives retries and quiet-hour releases).
* **Vercel:** `vercel.json` runs it once a day at 04:00 UTC (08:00 Dubai) — the most a Hobby plan allows. For timely retries and quiet-hour releases, add an external cron every 15 min (below), or on Vercel Pro change the schedule to `*/15 * * * *`. Vercel sends `CRON_SECRET` automatically.
* **Alternatives:** Supabase `pg_cron` + `pg_net` calling the URL, GitHub Actions `schedule`, or any external cron (cron-job.org) with the bearer header.

## Production deployment

1. Supabase project (region closest to UAE, e.g. Frankfurt/Mumbai — see data-residency note) → run migrations → enable daily backups (PITR on Pro).
2. Vercel: import the repo (no root-directory change needed), add all env vars from `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` must be server-only.
3. Set Supabase Auth Site URL / redirect URLs; configure SMTP for auth emails.
4. Add the Meta webhook + templates, and Resend domain (SPF/DKIM) for email.
5. Add error monitoring (Sentry) and uptime check on `/api/health`.

## Security & privacy notes (need legal / security review before storing real data)

* **UAE PDPL / data residency:** personal data (passports, Emirates IDs, salaries) is regulated; confirm hosting region, processor agreements (Supabase, Vercel, Meta, Resend), retention periods and breach procedures with counsel. Not legal advice.
* Never collect bank credentials/OTPs; cheque module stores only labels. Cheque "cleared" is a manual user confirmation.
* Not certified tax/e-invoicing software; have your accountant review invoice layout/VAT against UAE FTA requirements (and the upcoming e-invoicing mandate) before relying on it.
* WhatsApp content is limited to whitelisted, non-sensitive fields; long digit runs are masked.
* Known gaps: in-memory rate limiter (per instance) → use Redis/Upstash for multi-instance; CSP allows inline scripts (Next.js default without nonces); no malware scanner; MFA is optional and not enforceable per role yet; RLS on `storage.objects` is verified on stock Postgres with a stub, not on a live Supabase project.
