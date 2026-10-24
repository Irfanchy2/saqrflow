# Security

How Averiqo protects company data, and what an administrator has to do. Rules are enforced in the database and on the
server. The UI only hides what a user cannot do anyway.

## Layers

| Layer | What it enforces |
|---|---|
| **Database (Postgres RLS)** | Every table has row-level security. Tenant rows are visible only when `company_id = current_company_id()`. Writes also need the matching `has_permission(...)`. Soft-deleted rows are hidden by restrictive `not_deleted` policies. `current_company_id()` is null for an inactive user, or for a session that has not finished two-step verification. Such a session reads and writes nothing. |
| **Database functions** | Signed-out visitors (`anon`) cannot call any function. Cross-company helpers (`approval_setting`, `invoice_credits`) and trigger functions cannot be called by users at all. New functions start without public access (`alter default privileges`). |
| **Server actions / API** | `act()` checks the role permission before running, then runs the query as the user, so RLS applies again. Refused actions are logged (`security_events`). Public API v1 keys are stored hashed, scoped to their company, and rate-limited per key and per IP. |
| **Middleware** | Enforces sessions and two-step verification. Refuses cross-origin `POST` / `PUT` / `PATCH` / `DELETE` to `/api` (CSRF). Sends a per-request nonce Content-Security-Policy. |
| **Storage** | The `vault` bucket is private. Uploads must go to the user's company folder, need upload permission, and must be an allowed type (PDF, JPEG, PNG, WebP, Word, Excel; 15 MB). Files are only read through 60-second signed URLs, and each download is logged. |

## Sign-in
- **Passwords:**
  - 10–128 characters, at least 5 different characters;
  - not a common password, and not the email name;
  - under 14 characters, they must mix letters with digits or symbols.
- **Brute force:**
  - 5 failed attempts for an email within 15 minutes lock that email for 15 minutes;
  - each IP may make 100 attempts per 15 minutes;
  - a lockout alerts the company admins (at most once an hour).
  - The limits live in the database (`rate_limit_hit`), so all server instances share them.
- **Two-step verification (TOTP):** optional per user (Settings → Account). Once a user has a verified authenticator, every session needs the code. This is enforced by the middleware, the server and the database (`mfa_satisfied()`). Codes are limited to 5 tries per 5 minutes.
- **Sessions:**
  - Settings → Account lists the user's devices. Each can be signed out individually, or all other devices at once.
  - Admins can sign out any user.
  - A session ends after 24 hours without activity, and 30 days at most.
  - Supabase rotates refresh tokens on every refresh.
- **New device:** a sign-in from a browser not seen in 90 days records a `new_device` event and notifies the user.
- **Password recovery:**
  - Use "Forgot password?" on the sign-in page. The reply is the same whether or not the email exists.
  - Requests are limited to 3 per hour per email and 10 per hour per IP.
  - The emailed link is single-use and expires (Supabase setting).
  - Setting a new password signs out all other devices.
- **Sign-in history:** `login_events`. Users see their own; admins see the company's, under Users → Activity.

## Monitoring
Users → Activity shows sign-ins and the **Security events** log, which records:
- failed and locked sign-ins;
- failed two-step codes;
- refused actions;
- rejected API keys and webhook signatures;
- rejected uploads;
- password changes and new devices.

Admins get an in-app alert, throttled to one per hour per cause, for:
- locked accounts;
- a user refused 10+ actions in 10 minutes;
- repeated rejected API keys.

Server logs (Vercel) carry the technical details. Users only ever see a generic message.

## Uploads
Every upload is checked on the server:
- the extension;
- the declared type;
- the file signature (magic bytes);
- the size.

Documents with macros (`vbaProject.bin` / `_VBA_PROJECT`) and PDFs with `/Launch` actions are refused. This is a content check, not an antivirus engine (see *Remaining risks*).

## Share links, webhooks and outbound requests
- **Share links:**
  - The token is 32 random bytes, and only its SHA-256 hash is stored.
  - Every link has an expiry and can be revoked. Each use updates its use count and last-used time.
- **WhatsApp webhook:** requests are verified with HMAC-SHA256 over the raw body (`META_APP_SECRET`) and compared in constant time. Rejections are logged.
- **Outgoing webhooks:** signed `t=…,v1=HMAC` with a per-endpoint secret.
- **Cron:** routes require `CRON_SECRET`.
- **Payments:** no payment provider is integrated, so there are no Stripe webhooks.
- **Outbound webhook requests:** they go through the SSRF guard (`lib/net-guard.ts`). It allows only `http(s)`, blocks private, loopback and link-local ranges, and checks the address actually connected to (DNS rebinding).

## Secrets and environment variables
- Only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_APP_URL` reach the browser.
- Everything else is server-only, imported behind `server-only`:
  - `SUPABASE_SECRET_KEY`
  - `SETTINGS_ENCRYPTION_KEY`
  - `CRON_SECRET`
  - `META_APP_SECRET`
  - the WhatsApp, AI and OCR keys
- Set them in Vercel → Project → Settings → Environment Variables, never in Git. `.env.example` lists names only.
- Integration keys saved from Settings are AES-256-GCM encrypted with `SETTINGS_ENCRYPTION_KEY`. Saving or removing one is written to the audit log (the value never is).
- **Rotation:** to rotate a key, issue a new one at the provider, update it in Vercel, redeploy, then revoke the old one. Rotating `SETTINGS_ENCRYPTION_KEY` makes saved integration keys unreadable, so re-enter them in Settings afterwards.

## Encryption
- **In transit:** HTTPS only. HSTS is 2 years with `includeSubDomains`, plus `upgrade-insecure-requests`. The Supabase API and database connections use TLS.
- **At rest:** Supabase encrypts the database, backups and Storage (AES-256). Integration secrets are additionally encrypted by the app (above).

## Headers
- Content-Security-Policy, generated per request:
  - scripts must carry the request nonce (`'strict-dynamic'`);
  - `object-src 'none'`;
  - `frame-ancestors 'self'`, except embeddable public forms under `/f/`;
  - `base-uri 'self'` and `form-action 'self'`.
- Also sent:
  - `Strict-Transport-Security`
  - `X-Frame-Options: SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` (camera for this site only; microphone and geolocation off)
  - `Cross-Origin-Opener-Policy: same-origin`
  - `X-DNS-Prefetch-Control: off`
- `X-Powered-By` is removed.

## Backup and restore
See [BACKUP.md](BACKUP.md). In short:
- Supabase daily backups (enable **Point-in-Time Recovery** on Pro for minute-level restore);
- a weekly encrypted `pg_dump` plus a Storage copy kept off-site;
- restore to a new project first, then verify;
- single records are restored from Trash, or from audit and revision history.

## Admin checklist (Supabase dashboard)
1. **Authentication → Providers → Email:**
   - turn on **Leaked password protection** (checks HaveIBeenPwned);
   - set the minimum length to 10;
   - require email confirmation.
2. **Authentication → Sessions:** keep refresh-token rotation on. Optionally set a time-box (for example 30 days) and an inactivity timeout (24 hours) to match the app.
3. **Authentication → URL configuration:** add `https://<your domain>/auth/callback` to the redirect allow-list (needed for password reset).
4. **Authentication → Rate limits:** keep the defaults or lower them.
5. **Database → Backups:** confirm daily backups; consider PITR.
6. Ask every owner and admin to turn on two-step verification.

## Incident steps
1. **Suspected account takeover:**
   - Users → Activity → pick the user → *Sign … out everywhere*;
   - deactivate the user if needed;
   - reset their password;
   - check Users → Activity and the Audit log.
2. **Leaked key:** rotate it (see *Secrets*) and check `security_events` for `api_key_rejected`.
3. **Data changed wrongly:** use the Audit log, Trash and revisions; for bulk changes, restore from backup to a new project and copy the rows back.

## Employee Portal (migration 0030)

An `employee` login is confined to its own portal (`/me`), enforced in four layers:

1. **Middleware** passes the verified request path to the server (`x-averiqo-verified-path`, signed like the user id).
2. **`getCtx()`** sends an employee to `/me` from any page, server action or API outside `lib/portal-paths.ts` (the portal, receipt scan, own documents, own payslips, own notifications and photo).
3. **Server actions** check permissions (`need()`); employees hold none. Portal actions (`app/actions/me.ts`) act only on the caller's own employee record.
4. **RLS** (authoritative): `my_employee_id()` limits salary, advances, compensation, attendance and leave to the caller's own rows; restrictive policies hide colleagues' profiles and company configuration; employees cannot write HR records.

Expense claims (`expense_claims`) never touch `project_expenses` (or Tally exports) until an approver (`expenses.approve` or `approvals.decide`) approves them through `decide_expense_claim()`. That function locks the claim, refuses the approver's own claim, needs a reason to reject or send back, and inserts the company expense exactly once (unique links both ways). A trigger guard blocks every other change to decisions, links or the receipt. Every submission, edit, decision and withdrawal is kept in `expense_claim_events` and `audit_logs`. Receipts are validated (type from bytes, size, active content) and stored by the server as the claim's own document (`owner_type = 'expense_claim'`), visible to the employee and to finance/approvers only.

Self check-in (`attendance_punch()`) is off until Settings → Employee portal turns it on. It uses the server's clock and the company's date, once in and once out per day.
