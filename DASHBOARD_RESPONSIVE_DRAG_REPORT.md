# Dashboard: responsive fixes and drag-to-move cards

Date: 1 Nov 2026 · Branch: `dashboard-responsive-drag` · No database change.

## 1. Audit (demo company, every card switched on)

The dashboard was measured at 360, 390, 768, 1024, 1280, 1440 and 1920 px wide.

**What was measured:**
- anything sticking out of the screen;
- anything cut off inside a box;
- any strip that hid items sideways.

**What was found:**

| Problem | Where |
| --- | --- |
| Section tabs (Dashboard · Daily Brief · Smart Inbox · **Calendar**): the last one sat beside the screen and had to be swiped | phones |
| Latest documents card: its tabs (Recent quotations, invoices, payments, projects, expenses) were mostly hidden sideways | phones |
| Latest documents table: the **Status** column was cut off at the right edge | tablets and small laptops (768–1279 px) |
| Key figures (revenue, work orders, order book, on-time): a sideways strip, two of the four cards off screen | phones |

The page itself never scrolled sideways.

## 2. Fixes

- **Section tabs:** wrap onto a second line on phones, so every tab is visible.
- **Card tabs:** wrap; the "All documents" link sits above them when there is no room beside them.
- **Latest documents table** on tablets and small laptops: the *Project / subject* and *Issue date* columns step aside so the rest fits. Phones keep the stacked cards with every field; wide screens keep all columns.
- **Key figures on phones:** a 2 × 2 grid, so all four are visible at once. This applies to the dashboard only; other pages keep their swipeable strip.

**After the fixes**, at all 7 widths: nothing sticks out, nothing is hidden sideways, and the table fits its card.

## 3. Move cards by dragging

**Desktop:**
- Hover a card: a small grip appears at its top.
- Drag the grip to move the card. Other cards make room as it moves, and the page scrolls when the card is held near the top or bottom edge.

**Phones and tablets:** tap **Arrange** (next to Customize and Create new).
- Every card gets a finger-sized grip and a dashed outline.
- The cards' own links are paused so nothing opens by mistake.
- Tap **Done** to finish.

**Where cards can go:**
- within their area;
- between the left and right columns;
- the top area (Today, Key figures) keeps its own cards.

**Keyboard:** focus a card's grip and use the arrow keys.

**Saving:**
- Every move is saved straight away to your own layout; only you see it.
- It is the same layout **Customize** uses; show/hide and reset still work there.
- If a save fails, the cards go back to where they were and an error is shown.

## 3b. Notifications panel on phones

**What was wrong:** on phones the bell's panel opened as a thin strip, about the width of the bell.

**Why:** the panel uses "fixed" positioning so it can span the screen. The bell's round button, and the portal header, use a blur effect, and in browsers a blur effect turns that element into the reference frame for "fixed" children. So the panel was sized against the 56-pixel bell instead of the screen.

**Fix:** the panel is now drawn on the page body.
- **Phones:** it spans the screen under the header.
- **Larger screens:** it sits under the bell at full size.
- It closes on a tap outside, on Escape, or when a page opens.
- This covers both the admin app and the employee portal.

## 4. Tests actually run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | passed |
| Unit tests | 310 / 310 |
| New e2e `tests/e2e/dashboard-board.mjs` | 47 / 47 (see below; 6 notification-panel checks at 390 and 1440 px) |
| `portal.mjs`, `petty-extra.mjs` after the bell change | 119 / 119, 26 / 26 |
| Full `scripts/e2e.sh` (production build + 27 suites) | the other 26 suites all passed (smoke 141, portal 119, share 119, demo 38, QA sweep 56, …). dashboard-board failed only at setup in that run (the demo company already existed); after the fix it passed 41 / 41 run straight after the demo suite, as in the full run |

**What `dashboard-board.mjs` covers:**
- **All 7 widths:**
  - nothing sticks out of the screen;
  - section and card tabs are all visible;
  - the table fits its card;
  - every key figure is visible.
- **Desktop dragging:**
  - every card has a grip;
  - a card dragged within the right column;
  - a card dragged across into the left column;
  - the order is kept after reloading;
  - top cards stay in the top area;
  - the arrow key moves a card and focus stays on it.
- **Phone:**
  - no grips until Arrange;
  - Arrange shows the bar and the grips;
  - tapping a card while arranging does nothing;
  - dragging moves and saves;
  - Done ends arranging.

**Not tested:** a real phone's touch screen. The test drives the same pointer events with a mouse.
