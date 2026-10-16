# Performance rules

Averiqo pages are server-rendered on Vercel (bom1) next to Supabase (ap-south-1). Most of the time on a page goes to
round trips (middleware → page → database) and to how much HTML and React data the page sends. These rules keep
pages fast.

## Navigation feedback

- **Instant skeleton on tap.** `components/layout/nav-pending.tsx` shows the skeleton of the page that is coming (list, record or document builder; `components/ui/skeleton.tsx`) the instant an internal link or table row is tapped, and removes it when the new page has arrived.
- **Tabs and filters keep the page on screen.** Rows marked `.tabstrip` show only the top progress bar.
- **Pages arrive complete, not streamed.** There is no route-level `loading.tsx` and no Suspense streaming inside app pages.
  - With streaming, a later chunk could arrive after the user had already tapped elsewhere. That breaks React's streaming insert (seen in tests as `Cannot read properties of null (reading 'parentNode')` and React error 419).
  - Server actions also misbehave with route loading states (see `nav-progress.tsx`).
  - **The app layout has no `<Suspense>` either.** A boundary around the sidebar made it stream in a second HTML chunk on every load. When that chunk arrived while React was hydrating, React threw error #418 (about once per full test run, on any page).
    - The layout is `force-dynamic`, so `useSearchParams` needs no boundary there.
    - To check: no `<template id="B:` in a page's HTML.
  - Speed comes from doing less per page instead: the rules below.

## Load the main content first

- **One round of queries.** Start every query a page needs together (`Promise.all`). Supabase query builders are
  lazy, so wrap one in `Promise.resolve(...)` if it must start before you await it (see the dashboard).
- **Record pages with many sections are tabbed.**
  - The project page header renders from the project row alone.
  - Overview, Finance, Work, Files & photos and Activity each load only their own data (`?tab=`).
  - Shared figures (contract value, payments, costs) come from cached loaders in `lib/project-data.ts`, so two parts of one render never query twice.
- **Long lists are bounded.**
  - Lists paginate or `limit()`. Show "All N …" links rather than rendering hundreds of rows.
  - Expenses on a project: the latest 50 plus a count.

## Do not ship data the page is not showing

- **Form dropdowns load on demand.**
  - Customer, employee and user choices in forms use `RemoteSelect` / `CustomerSelect` (`components/ui/customer-select.tsx`).
  - The page carries only the current choice. The list is fetched from `/api/options/[kind]` the first time the dropdown is shown (its dialog opens), once per page.
  - Before this, a project page sent every customer twice (HTML + React data) for a hidden Edit form.
- **The document builder's customer picker searches the server** (`/api/customers/search`).
  - Debounced 200 ms; the previous request is cancelled.
  - Customers already on the page are matched locally while the request runs.
- **OCR stays in the routes that use it.** The ~11 MB of Tesseract language data and wasm are traced only into the Smart
  Inbox, its processing API, receipt scan, AI settings and the assistant (`next.config.mjs`). Every other server function
  stays small and starts faster.

## Database

- Filter by indexed columns.
  - Every table has `(company_id, …)` indexes for list pages.
  - Record pages filter by `project_id`, `customer_id`, `invoice_id` or `record_id`.
  - Migration `0022_performance.sql` adds the missing ones (activity log by record, cheques / leads / tickets / share links by owner, staff links, the notification bell).
- `invoice_balances` sums payments and credit notes per invoice through indexes. Results are identical to the earlier
  definition, which aggregated every payment first.
- RLS policies wrap `auth.uid()` as `(select auth.uid())`, so Postgres evaluates it once per query.
- Migrations are additive: `create index if not exists`, an equivalent `create or replace view`, the same policy rules.

## Measuring

The e2e gateway (`tests/e2e/fake-supabase.mjs`) can add network latency to every request, and counts database requests:

```bash
FAKE_LATENCY_MS=25 E2E_HOLD=1 E2E_ONLY=none bash scripts/e2e.sh   # build + hold the stack with 25 ms per request
curl 'http://127.0.0.1:54399/__stats?reset'                        # database requests since the last reset
```

Measured on that setup, at phone size, with 800 customers, 150 employees and 120 project expenses (median of runs).
Each cell reads before → after:

| Page | Tap → skeleton on screen | Tap → record on screen | Server render | DB queries | HTML + data |
|---|---|---|---|---|---|
| Project | 497 → 88 ms | 691 → 400 ms | 511 → 198 ms | 26 → 13 | 1,389 → 329 KB |
| Quotation | 345 → 90 ms | 532 → 562 ms | 303 → 274 ms | 23 → 22 | 518 → 318 KB |
| Invoice | 377 → 82 ms | 569 → 523 ms | 332 → 319 ms | 24 → 23 | 517 → 316 KB |
| Customer | 326 → 104 ms | 445 → 564 ms* | 276 → 269 ms | 28 → 25 | 401 → 331 KB |

Before, nothing on screen changed until the whole new page had arrived ("tap → skeleton" was the full load).
The document builder and the customer profile still make about 22–25 queries in one parallel round. Their time is
server-side work, not waterfalls, and is the next place to cut. *The customer row varies run to run (455–564 ms) with the latency gateway.
