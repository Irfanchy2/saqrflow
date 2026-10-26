# QA audit report: Averiqo (SaqrFlow)

Audit date: 25 Oct 2026 · Branch: `qa-audit` · Scope: the whole application, as six kinds of user, in a real browser.

Everything below that says "passed" was run and checked in this audit. Nothing was run against the production
database except read-only queries (counts and a duplicate check), and no production data was changed.

## 1. Architecture and feature inventory

**Stack**
- Next.js 15 (App Router, server components, server actions) on Vercel, region bom1.
- Supabase (Postgres with row-level security, Auth, Storage) in ap-south-1.
- Tailwind CSS. 33 SQL migrations.

**Security model**
- Every table is company-scoped through RLS (`current_company_id()`, `has_permission()`), so the database enforces access on its own.
- Server actions and API routes check permissions again (`need()`, `c.can()`).
- The middleware verifies the session and sets the CSP nonce. It also applies rate limits and a CSRF origin check for the API.

**Roles** (`lib/permissions.ts`)
- Company Owner / Super Admin: everything.
- HR Manager: documents, employees (sensitive), salary, export.
- Accountant: finance, cheques, salary, export, approve expenses.
- Project Manager: documents, upload, edit, employees, CRM.
- Read-only Viewer: documents, employees, CRM.
- Employee: the Employee Portal only.

**Inventory**
- 72 pages and 33 API routes.
- Main app modules:
  - Dashboard, Daily Brief, Calendar, Smart Inbox, Search, AI Assistant.
  - Sales: CRM leads, customers and suppliers with ledger and statements, site visits, quotations, tax invoices, delivery notes, credit notes, payments, catalog.
  - Operations: projects, work orders, site reports, tasks, Vehicles & Assets, service tickets.
  - Stock, Banking, Expenses (with Tally export), Cheques.
  - People & documents: employees, company documents, Document Vault, reminders, Knowledge Base.
  - Reports, Approvals.
  - System: Users and sign-in activity, Audit log, Trash, Settings, Import, Backup.
- Employee Portal: home, expenses with receipt scanning, attendance with check-in and overtime, salary and payslips, profile.
- Public token pages: customer portal, quote accept/reject, document requests, supplier portal, enquiry forms.
- Print views: sales documents, statements, reports, QR.
- Integrations: WhatsApp Business, webhooks, read-only API keys.
- Scheduled jobs: reminders and events.

## 2. Test environment and what was actually tested

**Environment** (`scripts/e2e.sh`)
- Real Postgres with all 33 migrations.
- Real PostgREST with RLS on.
- The production Next.js build (`next build && next start`).
- Headless Chromium through Playwright.
- A local gateway that stands in for Supabase Auth and Storage and for the external APIs (OCR.Space, Gemini, WhatsApp Graph). Nothing is sent to the outside world.

**Tests run** (see section 6 for results)
- **Type checking:** `tsc --noEmit`.
- **Unit tests:** Vitest, 279 tests.
- **Database tests:** RLS, tenant isolation, triggers and business rules (139 tests).
- **Browser suites:** 20 existing end-to-end suites covering the main workflows (headers in `tests/e2e/*.mjs`):
  - quotation → invoice → payment;
  - partial delivery;
  - credit notes, revisions, print and PDF;
  - expenses with OCR and Tally;
  - the employee portal with approvals;
  - stock, banking, WhatsApp, public portals, platform, demo.
- **New: `tests/e2e/qa-sweep.mjs`**, added to the full run:
  - **Seeded company:** a company filled with the app's own sample data, plus a second company for cross-company probes.
  - **Every page as each role:**
    - roles: owner, accountant, HR manager, project manager, viewer and employee (373 page views);
    - owner on desktop (1366 px) and phone (390 px);
    - for each view it records server errors, JavaScript errors, console errors, failed requests, horizontal overflow on phones, load time and accessibility facts.
  - **Detail pages:** every kind of record found on the list pages (10 kinds), plus project and employee tabs, the customer ledger and the print views.
  - **36 access probes:**
    - another company's invoice, customer, project, employee, document, PDF, statement and ledger, opened by ID;
    - finance and backup exports requested by non-finance roles and by an employee;
    - signed-out requests to APIs and pages.
  - **Regression checks** for the bugs fixed here (the opening balance).
  - **Customer form edge cases:**
    - a one-letter name and an invalid email;
    - Arabic text, quotes, `&`, `<b>` tags and a 200-character name;
    - persistence after reload, search by the Arabic name, and phone layout.
- **Static reviews:**
  - every API route's authorization;
  - `npm audit` of production dependencies;
  - a secrets scan of all tracked files;
  - input-size limits on server actions.

## 3. Confirmed issues

| ID | Severity | Where | Problem | Status |
|---|---|---|---|---|
| QA-01 | P1 | Sales: delivery note → invoice | The invoice was created with 0.00 prices. A delivery note has no prices, so the invoice copied 0.00 for every line. Found in production: INV-577 and INV-578. | Fixed (PR #48, merged) |
| QA-02 | P2 | Sales: delivery note → invoice | A second invoice could be created from a delivery note that was already invoiced (converted earlier, or made from an invoice), which bills the customer twice. | Fixed |
| QA-03 | P2 | Customers | Users without finance access (HR, Project Manager) saw a customer's **opening balance** (money owed) in the Edit form and could change it. HR's customer export and backup also included it. | Fixed |
| QA-04 | P3 | Employees (Accountant) | Staff whose role has no employee access were told "No employee record is linked to your account. Ask HR to link…", which is wrong for an accountant. | Fixed |
| QA-05 | P3 | Accessibility | 13 form controls had no label for screen readers: filter boxes on Cheques, Employees and Vault; API-key fields in Settings; the employee photo upload; the invoice "Internal notes" box. 4 pages had duplicate element IDs (suggestion lists repeated in each form on Banking, Stock and Expenses). | Fixed |
| QA-06 | P3 | Redirect when a role opens a page it may not use | Seen once in 3 sweeps (Viewer typing `/cheques`): an intermittent React hydration warning (#418) while being sent to the dashboard. No visible effect; the page recovers by itself. | Open: not reproducible on demand (see 7) |
| QA-07 | P2 (dependency) | zod 3.25.76 | Advisory GHSA-mrhx-c7xc-m3w5: validating an oversized list can exhaust memory. | Mitigated (see 4); full fix needs zod 4 |
| QA-08 | Info (dependency) | next (bundled postcss 8.4.31), onnxruntime-node (adm-zip 0.5.18) | Advisories in build-time and install-time code only. They are not reachable from user input at runtime. | Documented; fixes need major upgrades |

**Checked and found not to be bugs:**
- **HR Manager can download the backup:** HR has `data.export` by design, and the backup contains only the lists HR may see (RLS-scoped). After QA-03 it no longer contains opening balances.
- **`/print/qr` returns 404 when opened without parameters:** the page needs the data to encode, and it is only opened from links that pass it.
- **Accountant gets "not found" on an employee page:** that role has no employee access, and the link exists only in other roles' lists.

## 4. Root causes and changes

**QA-02: second invoice from a delivery note**
- Root cause: the conversion was offered and accepted whether or not the delivery note already had an invoice.
- `app/actions/sales.ts` (`convertSalesDoc`) refuses a second invoice while the linked invoice stands (not cancelled, not in the trash). The message is "This delivery note is already invoiced as INV-…".
- `app/(app)/invoices/[id]/page.tsx` and `components/sales/editor.tsx` no longer show "Create tax invoice" in that case.

**QA-03: opening balance visible to non-finance users**
- Root cause: the form and the save action treated the opening balance like any other customer field.
- `components/parties/party-fields.tsx` shows the opening balance fields only to finance users.
- `updateParty` (`app/actions/projects.ts`) and `createParty` (`app/actions/admin.ts`) save them only for finance users. For anyone else the stored value is kept. Before, a save without the field would have reset it to 0.
- `lib/exports.ts` and the export and backup routes include the column only for finance users.

**QA-04:** new empty-state text on `app/(app)/employees/page.tsx`.

**QA-05: labels and duplicate IDs**
- Added `aria-label`s on the unlabelled controls.
- Made the suggestion-list IDs unique per form: the record ID in `app/(app)/stock`, `app/(app)/banking`; `useId` in `components/expenses/expense-fields.tsx`.

**QA-07: input-size limits** (no behaviour change for real use)
- JSON fields in forms are limited to 200,000 characters before parsing (`jsonOf` in `app/actions/me.ts` and `app/actions/projects.ts`).
- The sales document's 300-line limit is checked before validation.
- The notification-channel lists have a maximum.

**QA-01:** fixed earlier today in PR #48 (prices come from the quotation lines). Its regression test is in `erp.mjs` [X2], which this audit extends with the QA-02 check.

## 5. Automated tests created

- **`tests/e2e/qa-sweep.mjs`** (new, in `scripts/e2e.sh`):
  - role × page sweep, phone layout, JS and console errors, failed requests, slow pages, accessibility facts;
  - 36 access-control probes;
  - opening-balance regression (QA-03);
  - customer form edge cases.
- **`tests/e2e/erp.mjs` [X2]:** a delivery note → invoice takes the quotation's prices (QA-01). Once invoiced, the delivery note no longer offers a second invoice (QA-02).

## 6. Results

Baseline, before any change in this audit:

| Check | Result |
|---|---|
| `tsc --noEmit` | passed |
| Unit (Vitest) | 279 / 279 passed |
| Database (RLS, rules) | 139 / 139 passed |
| Browser suites (20) | 1,165 / 1,165 checks passed, production build included |
| `npm audit --omit=dev` | 5 advisories (4 high, 1 moderate) in 3 packages: see QA-07, QA-08 |
| Secrets scan | nothing found; `.env*` files are git-ignored |
| First QA sweep | 45 / 47: found the HR backup (by design, see 3) and QA-06 |

### 6b. Final run, after the fixes (same commands, fresh stack)

| Check | Result |
|---|---|
| `tsc --noEmit` | passed |
| Unit (Vitest) | 279 / 279 passed |
| Database (RLS, rules) | 139 / 139 passed (with the QA-03 code change: no migration) |
| Browser suites (20) + QA sweep | **1,223 / 1,223 checks passed**, `scripts/e2e.sh` exit 0, production build included. `erp.mjs` 59/59 (2 new), `qa-sweep.mjs` 56/56 |
| QA sweep findings | 373 page views and 36 access probes:<br>• 0 server errors, 0 JavaScript errors (QA-06 did not recur), 0 phone overflows, 0 pages over 3 s<br>• 0 cross-company leaks, 0 unauthorised API answers<br>• accessibility findings down from 16 to 2 |

**Not run, and why**
- Tests against the production database or the live site: not allowed, because they would write real data.
- Real email, WhatsApp, OCR and AI services: replaced by the local stand-ins on purpose.
- Screen-reader and keyboard-only sessions: no assistive technology is available in this environment.

**Still open from the sweep (P3):**
- one button with no visible text or label in Settings, and one in the invoice editor;
- the sweep could not identify them reliably: the buttons inside collapsed sections read as empty;
- the full markup is in `tests/e2e/shots/qa/sweep.json`; next step is to name them.

## 7. Remaining concerns

- **QA-06 hydration warning:** seen once in about 1,100 page views. A page redirect thrown during a streamed render is the likely trigger. The user sees nothing. Recommendation: keep the sweep in the full run and investigate if it starts appearing more often.
- **zod 4 upgrade** (QA-07): a major version. It needs a separate change across about 40 schemas and a full test run. The size limits added here remove the practical risk.
- **Next 16 / onnxruntime 1.30** (QA-08): major upgrades, to be planned and tested separately.
- **Tested against stand-ins, not the real services:** Supabase Auth and Storage, email, WhatsApp and the AI providers were replaced by the local gateway. Their live behaviour was not tested here, by design: no production writes, no real messages.
- **Accessibility:** these are automated checks (labels, names, alt text, duplicate IDs, phone overflow). No screen-reader or keyboard-only session was recorded.
- **Two draft invoices in production** (INV-577, INV-578) still have 0.00 prices from QA-01. After this change, a new invoice from their delivery notes is offered only once those drafts are deleted (moved to the trash). The data was left untouched: it is the owner's decision.

## 8. Performance findings

- **Page loads:** no view took over 3 s on the local production build (373 views). The slowest pages are the Dashboard and Settings, at about 0.5 s to the first byte with 25 ms of database latency added (measured in PR #46).
- **Real-world delays come mostly from:**
  - cold starts on the Vercel Hobby plan (the first request after the app has been idle);
  - one Supabase Auth call per request in the middleware (`getUser`).
- **Already done (PR #46):**
  - one parallel round of queries per page;
  - the Employee Portal down by one or two database round trips;
  - about 100 KB less JavaScript on the login page and in the portal.
- **Next options:**
  - verify sessions locally with `getClaims()` if the Supabase project uses asymmetric JWT signing keys;
  - Vercel Fluid compute or a paid plan to reduce cold starts.

## 9. Migration and deployment steps

- No database migration in this audit. Merge the PR; Vercel deploys it.
- Optional, owner's decision: move the draft invoices INV-577 and INV-578 to the trash, then create them again from their delivery notes. They will then carry the quotation prices.

## 10. Recommendations

1. Keep `qa-sweep.mjs` in the full run. It catches permission, layout, error and accessibility regressions on every page and role.
2. Plan the zod 4 and Next 16 upgrades as their own changes, each with a full test run.
3. Ask the business before extending money-related rules further: who may see opening balances and outstanding amounts, and whether delivery notes should ever show prices.
4. For speed: switch middleware verification to `getClaims()` if the project uses asymmetric signing keys, and consider Fluid compute or a plan without cold starts.
