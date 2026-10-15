# Averiqo design system

Averiqo is the software brand. Company identity (letterhead, stamp, legal name) appears only inside business documents and as the company name in the app chrome.

## Identity

- **Navigation:** deep navy sidebar (`bg-sb`, tokens `--sb-*`) in both themes. The current page is a filled blue pill (`bg-sb-accent`). Sections have small uppercase labels.
- **Content:** a light, blue-tinted page (`bg-bg`) with white cards (`bg-surface`, `rounded-xl`, hairline border, soft `shadow-card`).
- **Colour:**
  - Averiqo blue (`primary`) for links, tabs, the active nav item and charts.
  - Navy ink (`ink`) for the main action button on each page. In dark mode the ink becomes the primary blue.
  - Status colours (`success`, `warning`, `danger`) appear only as a tint with readable text.
  - KPI icon tiles rotate through soft tints (blue, orange, emerald, violet, sky, amber); a red tile means a problem.
- **Type:** Geist with tabular figures. Size and weight by role:

| Role | Size and weight |
|---|---|
| Page title | 24 px bold |
| Card title | 15 px semibold |
| KPI value | 22 px bold |
| Table header | 12.5 px medium |
| Body | 14 px |

- **Radius:** 6 px chips · 8 px controls · 10 px small containers · 12 px cards.

Tokens live in `app/globals.css` and the Tailwind scale in `tailwind.config.ts`. **Print and PDF are separate:** `.sales-paper` has its own variables and never uses app tokens.

## Layout

- **Shell:** `app/(app)/layout.tsx`
  - **Sidebar:** `components/layout/sidebar.tsx`. Brand plus "Business Operating System"; Dashboard group, then Sales (CRM, Customers, Site visits, Quotations, Invoices, Delivery notes, Payments, Catalog), Operations, Finance, People & documents, Reports and System.
    - It collapses from 256 px to a 68 px icon rail with tooltips; the choice is a cookie (Ctrl+\).
    - On phones and tablets it becomes a drawer.
  - **Top bar:** search (Ctrl K), company location, notifications, settings, theme, and the user menu (account, settings, sign out).
- **Page:** `PageHeader` (optional breadcrumb `crumbs`, title, one line of context, actions on the right).
- **Metrics:** `Metrics` + `StatCard` give a row of KPI cards. Each card has an icon tile, a label, the value, an optional change (`change`, %), a hint and optional mini bars (`bars`). Every card that counts something links to the list behind it.
- **Dashboard** (`app/(app)/page.tsx`):
  - **Main column:** greeting with a date card and **Create new**; a banner with today's workload; KPI cards; the 12-month sales overview (area chart) beside Quick actions; recent documents in tabs; recent activity; projects in progress.
  - **Right column** (≥1536 px): my tasks (tick to complete), needs attention, the month calendar and operations.
  - Below 1536 px the right column flows as a grid under the KPI cards.
  - Widgets can be hidden or moved (Customize).

## Interaction rules

- **Whole-row click:** every data table (`TableWrap`) is clickable. Clicking a row's empty space opens its record: the first *visible* link marked `data-row-primary`, otherwise the row's first page link (`components/layout/row-navigator.tsx`).
  - Buttons, inputs and other links keep their own action.
  - Ctrl/⌘/middle-click opens a new tab.
  - On Customers, a row opens the preview panel on wide screens and the profile on phones.
- **Kanban** (CRM): tinted stage columns with rich cards.
  - Drag a card, or use its "Move to" menu.
  - "Add lead" sits at the foot of each column.
- **Dialogs:** phones get a bottom sheet. Wide forms open as a side drawer from 1024 px, and the Save bar is pinned.
- **Deleting:** important records go to **Trash** (restorable). Removing money records always asks first.
- **Touch:** hover styles apply only on devices that can hover.

## Motion

Framer Motion through `components/motion.tsx` (LazyMotion, `reducedMotion="user"`, 140 / 200 / 280 ms, decelerating).

Used for: sidebar width, the mobile drawer, menus, toasts, tabs and page enter.

## 3D

Three.js appears only in the sign-in hero. It loads lazily and is skipped on small screens, without WebGL and with reduced motion.
