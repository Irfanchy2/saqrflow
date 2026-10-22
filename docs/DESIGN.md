# Averiqo design system

Averiqo is the software brand. Company identity (letterhead, stamp, legal name) appears only inside business documents and as the company name in the app chrome.

## Identity

- **Navigation:** glass pill tabs across the top (one per group) with an ink pill on the current group, section pills under them, and a floating ink dock at the left edge. Phones and tablets keep the drawer and the bottom bar.
- **Content:** a warm "paper" page (`bg-bg`) behind a slow, soft colour mesh (`.mesh`), with white cards (`bg-surface`, `rounded-xl` = 20 px, hairline border, soft `shadow-card`).
- **Colour:**
  - Averiqo blue (`primary`) for links, tabs, the active nav item and charts.
  - Navy ink (`ink`) for the main action button on each page. In dark mode the ink becomes the primary blue.
  - Status colours (`success`, `warning`, `danger`) appear only as a tint with readable text.
  - KPI icon tiles rotate through soft tints (blue, orange, emerald, violet, sky, amber); a red tile means a problem.
- **Type:** Urbanist for the interface (variable, self-hosted), Geist behind it and for documents, PDFs and print; tabular figures. Size and weight by role:

| Role | Size and weight |
|---|---|
| Page title | 34 px semibold, −0.035 em (26 px on phones) |
| Card title | 15 px semibold |
| KPI value | 23 px semibold |
| Table header | 12.5 px medium |
| Body | 14 px |

- **Radius:** 6 px chips · 8 px small controls · 10 px buttons, inputs and tiles · 14 px cards · 18 px sheets and dialogs.
- **Elevation:** one light source from above. Each layer is a hairline plus a short contact shadow and a long soft one, tinted navy (`shadow-card` at rest, `shadow-lift` on hover, `shadow-pop` for menus, dialogs and toasts). Dark mode adds a faint top highlight.

## Components

- **Buttons:** tactile. The button sets its icon size: 14 px small, 16 px regular, 18 px icon-only.
  - Filled (`primary` navy ink, `blue`, `danger`): a top highlight, a hairline in their own colour and a soft coloured shadow that deepens on hover.
  - `secondary`: reads as a key (hairline, faint bottom edge).
  - Every button presses in by 2%.
  - The dashboard banner's main action is a pill with its arrow in a nested disc that nudges forward on hover.
- **Fields:** a recessed well with a hairline that darkens on hover and a soft blue halo on focus. Every single-choice dropdown uses the same chevron. File pickers get a small secondary button.
- **Cards and KPI cards:** 14 px radius, a hairline and the card shadow. Popovers and menus use 12 px. A card that links somewhere lifts 1 px on hover and presses in on touch.
  - KPI icon tiles take their colour from what the figure means: money received or profit green, receivables and balances amber, costs orange, quotations and leads violet, sales and contract value blue. A problem is red. Anything else rotates.
- **Money:** amounts always show in full, with 2 decimals and never abbreviated or cut off.
  - `Money` sets the "AED" smaller and quieter and keeps the figure on one line.
  - KPI values shrink to fit their card (`.kpi-fit`, sized from the figure's length) instead of wrapping.
- **Status badges:** a tint, an inset hairline and a leading dot in the same colour (for plain-text statuses).
- **Tabs:** underline tabs for sections and filters (counts sit in a small pill). A segmented control (`SEG` / `segItem`) is used for view switches: a recessed track with a raised thumb. The chart series switch glides its thumb.
- **Menus and notifications:** 12 px radius, the pop shadow and an entrance that rises 4 px. The notifications panel spans the width on phones.
- **Dialogs:** 18 px radius with a pinned Save bar. Phones get a bottom sheet with a grab handle that rises into place.
- **Empty states:** the icon sits in a raised tile inside two hairline rings that fade out downwards, followed by a title, one line of help and the next step. Dashboard widgets use the `compact` version: a smaller tile, no rings, tighter spacing. Both settle in over 260 ms.
- **Phone tab bar:** a frosted bar. The active tab has a soft blue pill that glides to the tab you open, a filled icon and a blue label; tabs press in.

Tokens live in `app/globals.css` and the Tailwind scale in `tailwind.config.ts`. **Print and PDF are separate:** `.sales-paper` has its own variables and never uses app tokens.

## Layout

- **Shell:** `app/(app)/layout.tsx`
  - **Top tabs** (`components/layout/top-nav.tsx`, `TopTabs`): Dashboard, Sales, Operations, Finance, People, Reports. Each nav item carries its group (`top`). A tab opens the group's first page, shows a count of what needs attention (overdue invoices, late tasks, cheques due in 7 days, documents expiring in 30 days) and lists the group's pages on hover. System pages (users, audit log, trash, settings) are reached from Settings.
  - **Section tabs** (`SubTabs`): the pages of the current group, under the header (hidden when the group has one page).
  - **Dock** (`components/layout/dock.tsx`): search (Ctrl K), Create (C, a menu of new records), theme, help and settings, fixed at the left edge from 1024 px.
  - **Header:** brand and company, the tabs, notifications and the user menu. Below 1024 px: menu button (drawer, `components/layout/sidebar.tsx`), brand, search, notifications, settings, theme.
- **Page:** `PageHeader` (optional breadcrumb `crumbs`, title, one line of context, actions on the right).
- **Metrics:** `Metrics` + `StatCard` give a row of KPI cards. Each card has an icon tile, a label, the value, an optional change (`change`, %), a hint and optional mini bars (`bars`). Every card that counts something links to the list behind it. Phones show the cards as one swipeable strip. Tablets use three columns only when the cards fill the rows, so 4 or 8 cards sit 2-up with none left alone.
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

## Phones

- **Bars:** top bar (menu, logo, search, alerts, account) and the bottom tab bar (Home, Sales, Projects, Tasks, More). Any other module you open takes the second slot under a short name; every tab has the same width.
- **Header actions** wrap onto a second line instead of scrolling, so the main action is never off-screen.
  - On record pages, **Delete** is icon-only on phones (it keeps its accessible name).
- **List rows** (`MRow`): long names wrap to two lines, then end in an ellipsis, with the full text as a tooltip. Amounts use `Money`. A row darkens slightly while pressed.
- **Quick actions:** compact, borderless tiles. Phones show 8 in two rows of four; the desktop card shows 9 in three rows of three.
- **Scrolling rows** (tabs, filters, KPI strips) carry the `tabstrip` class.
  - The side that has more fades out through a CSS scroll-driven animation; no script edits the HTML.
  - `components/layout/strip-edges.tsx` scrolls the current tab into view.
- **Record pages with many sections use tabs** (the project page: Overview, Finance, Work, Files & photos, Activity). Each tab loads on its own. See `docs/PERFORMANCE.md`.
- **Sales** sections are pills on phones, so they read differently from the status tabs under them; from 640 px they are underline tabs.
- **Settings** sections are a sticky row of chips under the top bar; Users, Audit log and Trash sit at its end.
- **Floating "+" and action bars:** `main` adds bottom room when the page has a `.fab` (floating +) or a `.dock` (the document editor's WhatsApp/PDF bar), so nothing ends up under them.
- **Touch targets:** 40 px or more for anything tappable, including text links such as "View all", back links, calendar arrows and report periods. Negative margins keep the layout unchanged.

## Icons

- One family everywhere: **Phosphor Icons** (MIT), through `components/icons.ts`. It keeps the names the code already uses, so a screen never mixes styles.
- Regular weight by default; **fill** marks the active item (sidebar, tab bar).
- The SSR entry needs no React context and is tree-shaken, so a page only ships the icons it draws.
- Navigation icons are picked per module in `components/layout/sidebar.tsx` (`ICONS`).

## Motion

Framer Motion through `components/motion.tsx` (LazyMotion with layout animations, `reducedMotion="user"`, 140 / 200 / 280 ms, decelerating). CSS transitions use the same curve (`cubic-bezier(.2,.8,.2,1)`); nothing is linear or bouncy.

Used for:
- **Navigation:** the ink pill slides between top tabs and the white pill between section tabs (spring, shared layout); tab menus and the dock's create menu fade and scale in; dock labels slide out on hover or focus.
- **Interactions:** a hover wash plus a 1 px icon lift on hover, and a 1.5% press scale.
- **Elsewhere:** the mobile drawer, menus, toasts, tabs and page enter.

## 3D

Three.js appears only in the sign-in hero. It loads lazily and is skipped on small screens, without WebGL and with reduced motion.
