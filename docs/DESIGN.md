# Averiqo design system

Averiqo is the software brand. Company identity (letterhead, stamp, legal name) appears only inside business documents, never in the app chrome.

## Identity

- **Navigation:** sits on a deep navy surface (`bg-sb`, tokens `--sb-*`) in both light and dark themes.
- **Content:** sits on a calm, slightly blue-tinted paper (`bg-bg`) with white surfaces (`bg-surface`).
- **Accent:** one, Averiqo blue (`primary`). Status colours (`success`, `warning`, `danger`) appear only as a tint with readable text; a saturated status fill is never used.
- **Type:** Geist, with tabular figures for every number (`tabular-nums` is on all tables). Size and weight by role:

| Role | Size and weight |
|---|---|
| Page title | 22 px semibold |
| Card title | 14 px semibold |
| Table header | 12 px medium |
| Body | 14 px |

- **Radius:** 4–5 px chips · 6 px controls · 8 px containers. Tables are never rounded on their own.
- **Elevation:** borders separate surfaces. `shadow-card` is a 1 px hairline lift; real shadows (`shadow-pop`) are only for menus, dialogs and toasts.

Tokens live in `app/globals.css` and the Tailwind scale in `tailwind.config.ts`. **Print and PDF are separate:** `.sales-paper` has its own variables and never uses app tokens, so themes and motion cannot reach documents.

## Layout

- **Shell:** `app/(app)/layout.tsx`
  - **Sidebar:** `components/layout/sidebar.tsx`. Grouped and foldable sections; the 248 px sidebar collapses to a 60 px icon rail with tooltips; the choice is a cookie (no flash); a drawer on phones and tablets.
  - **Top bar:** search with Ctrl K, date and time zone, notifications, and the global **Create** menu.
- **Page:** `PageHeader` (title, one line of context, actions on the right). Content max width is 1680 px.
- **Metrics:** use `Metrics` + `StatCard` (one ruled strip), not a field of floating KPI cards. On the dashboard the pulse strip shows four numbers that belong together, with sparklines only where 12 months of history explain the number.

## Interaction rules

- **Whole-row click:** every data table (`TableWrap`) is clickable. Clicking a row's empty space opens its record: the link marked `data-row-primary`, otherwise the row's first page link (`components/layout/row-navigator.tsx`).
  - Buttons, inputs, menus and other links in the row keep their own action.
  - Ctrl/⌘/middle-click opens a new tab.
  - Selecting text never navigates.
  - Opt out with `data-rows-off` on a container; mark any card or list item with `data-row-link` to make it clickable as a whole.
- **Dialogs** (`components/ui/dialog.tsx`, native `<dialog>`):
  - Phones get a bottom sheet.
  - Short forms open centred.
  - `wide` forms open as a full-height **side drawer** from 1024 px.
  - The Save bar of a form inside a dialog is pinned to the bottom.
- **Deleting:** important records go to **Trash** (soft delete, restorable). Actions that remove money records (payments, expenses) always ask first.

## Motion

Framer Motion through `components/motion.tsx`:
- `LazyMotion` + `m.*` components, so only the small DOM feature set ships.
- `MotionConfig reducedMotion="user"`, so the OS "reduce motion" setting turns animation off.
- Durations of 140 / 200 / 280 ms, decelerating, no springs or bounces.

Used for:
- Sidebar width, folding sections, the active-item marker and the mobile drawer.
- Menus, toasts, tabs (sliding underline), page enter (4 px rise + fade) and chart bars.

Never used on table rows or for continuous decoration.

## 3D

Three.js appears in one place: the sign-in hero (a steel gear and I-beam, the company's trade).
- It loads lazily after the form is interactive.
- It is skipped on small screens, without WebGL, and with reduced motion.
- Data-entry screens, tables and documents never use 3D.
