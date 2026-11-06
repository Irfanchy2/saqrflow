# Evolution API integration report

Request: "https://github.com/evolution-foundation/evolution-api install this skill & integrate to my app"

## What Evolution API is (and is not)

Evolution API is not a Claude skill or an npm package that can be installed into the Next.js app. It is a separate,
open-source server (Node + Baileys, Apache-2.0, v2.3.7 at the time of writing) that keeps a WhatsApp Web session open
for a normal WhatsApp number (linked by QR code) and exposes it as an HTTP API. It must run on an always-on server
(Docker on a VPS, Railway, Render). It cannot run on Vercel.

What was built: Averiqo can now use an Evolution API server as its WhatsApp provider, side by side with the existing
Meta Cloud API integration. The API routes and payloads were taken from the project's source code (`instance.router.ts`,
`sendMessage.router.ts`, `sendMessage.dto.ts`, `instance.controller.ts`, `webhook.controller.ts`, `renderStatus.ts`).

## Features

* **Settings → WhatsApp via Evolution API**: switch on/off; server URL, instance name, API key (AES-GCM encrypted,
  never shown again); *Test connection*; *Remove stored key*; badge Off / Not linked / Linked · live / Linked · sandbox.
* **Link WhatsApp by QR code**: Averiqo creates the instance on the server (`POST /instance/create`, Baileys, QR on),
  sets the webhook to `/api/webhooks/evolution/<company id>` with a random 256-bit secret header, shows the QR code,
  detects the scan every 3 s and refreshes the code every 40 s. Pairing code shown when the server returns one.
  *Unlink number* logs the phone out (`DELETE /instance/logout`).
* **Sending**: every existing *Send via WhatsApp* button now works through Evolution when it is selected.
  * PDFs (invoice, quotation, delivery note, receipt, salary receipt, statement) are sent as real WhatsApp documents
    (`POST /message/sendMedia`, `mediatype: document`) with the message as caption.
  * No Meta templates and no 24-hour window: *Write a custom message* is always available.
  * Internal notifications (reminders, daily summary, alerts, test message) go as plain text (`POST /message/sendText`).
* **Webhook** (`messages.update`, `messages.upsert`, `connection.update`): sent → delivered → read (never downgraded),
  a tax invoice read on WhatsApp is marked *Viewed*, STOP / START opt-out / opt-in (scoped to the company), 24-hour
  contact tracking.
* **Errors**: number not on WhatsApp → failed at once with a clear reason; phone offline / unlinked / server error →
  kept and retried automatically (up to 4 attempts) with the reason shown; wrong API key / instance → hint where to fix.
* Switching back to Meta needs only unticking the box; nothing is deleted.

## Security

* Only *settings.manage* users can change the connection or link / unlink; the shared demo company is blocked
  (`demoGuard`) and never sends (forced sandbox).
* Server URL must be `https://`, without credentials / query, and must resolve to a public address (checked before every
  call; redirects refused) so a stored URL cannot reach internal services. (`WEBHOOK_ALLOW_PRIVATE=1` only in tests.)
* API key and webhook secret stored encrypted in `integration_secrets` (service role only, no RLS policies). The key
  is never returned to the browser (checked in e2e).
* Webhook: constant-time check of the `x-averiqo-token` header against the company's secret; wrong / missing → 401 and
  a security event; events for another instance ignored; all updates filtered by `company_id`.
* Audit log entries for key set / removed, provider changes, instance created, number unlinked.
* Existing masking (Emirates ID, passport, IBAN, card numbers) applies to every Evolution message; salary amounts are
  never in message text.

## Database

No migration. Uses existing tables only: `app_settings` (keys `whatsapp.provider`, `whatsapp.evolution_url`,
`whatsapp.evolution_instance`), `integration_secrets` (names `evolution_api_key`, `evolution_webhook_secret`),
`notification_logs`, `whatsapp_contacts`, `notification_recipients`, `invoices.viewed_at`. Existing data is untouched;
the default provider stays Meta, so nothing changes until an admin switches it on.

## Files

* New: `lib/whatsapp/evolution-core.ts` (pure helpers), `lib/whatsapp/evolution.ts` (server client),
  `app/actions/evolution.ts`, `app/api/webhooks/evolution/[company]/route.ts`, `components/settings/evolution.tsx`,
  `components/settings/evolution-link.tsx`, `docs/EVOLUTION_API.md` (server set-up guide with docker-compose),
  `tests/unit/evolution.test.ts`, `tests/e2e/evolution.mjs`.
* Changed: `lib/whatsapp/client.ts` (provider in config), `lib/reminders/settings.ts`, `lib/reminders/engine.ts`
  (config + internal sender), `lib/reminders/mode.ts` (status text), `lib/whatsapp/outbox.ts` (prepare / send /
  deliver), `app/actions/whatsapp.ts` (Test connection; Meta template actions say "not needed"),
  `components/whatsapp/send.tsx`, `app/(app)/settings/page.tsx`, `lib/security.ts` (audit action name),
  `tests/e2e/fake-supabase.mjs` (Evolution API stand-in), `scripts/e2e.sh`, `docs/WHATSAPP.md`.

## Tests (run in this session)

* Typecheck (`tsc --noEmit`): clean.
* Unit tests: 321 passed, 2 skipped (28 files), including 13 new Evolution tests (URL / SSRF checks, payloads, error
  classification, QR parsing, webhook parsing, provider settings).
* New e2e suite `tests/e2e/evolution.mjs`: 48/48, real browser against a local Evolution API stand-in: settings
  validation, encrypted key never sent to the browser, QR linking with webhook + secret header, scan detected,
  Test connection, invoice PDF sent as a WhatsApp document, custom message any time with ID masking, webhook auth (no
  token / wrong token / other company → 401), other instance ignored, delivered → read, invoice marked viewed, no
  downgrade, STOP / START, number not on WhatsApp, phone unlinked → retry, internal test notification as text, 360 px
  phone layout, unlink, switch back to Meta → sandbox with nothing sent to Evolution.
* Full e2e run (all 28 suites): 27 suites fully green, including the existing Meta WhatsApp suite (49/49), petty cash
  (47/47, 26/26), portal (119/119), QA sweep (56/56) and the new Evolution suite (48/48). One check in the share suite
  ("share logged: payslip…", a database read right after a click in the manual wa.me share flow, which this change
  does not touch) failed once; the share suite passed 119/119 both before and after on fresh stacks.

No real WhatsApp message was sent: every send in the tests went to the local Evolution API stand-in.

## What you need to do

1. Run an Evolution API server (guide: `docs/EVOLUTION_API.md`): a small VPS with Docker, a domain such as
   `wa.yourcompany.com`, and a random `AUTHENTICATION_API_KEY`.
2. In Averiqo: Settings → WhatsApp via Evolution API → tick the box, enter the URL, an instance name and the API key →
   Save → Link WhatsApp → scan the QR code with the company phone → Test connection.
3. Make sure *Force sandbox mode* (Meta section) is off.

Risk to know: Evolution API uses WhatsApp Web, which WhatsApp does not officially support for businesses. Use a
dedicated number, message only people who expect it and avoid bulk marketing, or the number can be banned.
