# Design audit report: Averiqo

Audit date: 26 Oct 2026 · Branch: `apple-design-polish` · Method: the Apple Design Skill (`apple-design`, 123 HIG pages).
The five lenses are accessibility, conventions, visual craft, interaction and writing. They were applied to the source code and to
real-browser screenshots at 1440 px (desktop) and 390 px (phone).

Averiqo is a web app, so the skill's principles and foundations apply in full: accessibility, colour, typography, layout and writing.
Apple-only conventions were adapted for the web. For example, the menu bar becomes the top navigation, and the theme switch is kept
(see Low findings).

No data, business logic, permissions, calculations, document numbering or workflows were changed.
No database migration is part of this change.

## Summary

Rating before: **Critical issues**. Rating after: **Good**. Nothing Critical or High remains open; three Medium items are left for a follow-up.

Averiqo already had a clear point of view: a calm, light shell with one blue accent, a dark ink tab bar on phones, and
Urbanist with Chakra Petch for figures and labels. Focus rings, reduced-motion handling and dark-mode contrast were already sound.
What held it back was a set of small accessibility failures that repeat on every screen, plus inconsistent wording and date formats.

## Findings and what was done

### Critical (accessibility)

1. **Light-mode text contrast below 4.5:1.**
   Status colours on their own 10% tints, and the primary blue on the page background, measured 3.73–4.49.
   - Rule: `accessibility.md`: text up to 17 pt needs 4.5:1.
   - Fixed in the tokens (`app/globals.css`, light only):
     - primary `214 78% 45%`, success `152 60% 29%`, warning `28 90% 34%`, danger `354 70% 47%`.
     - Every light-mode text pair is now **4.64:1 or higher**.
     - Before → after: warning tint 3.73 → 4.82; success tint 4.18 → 4.86; primary on background 4.23 → 4.70; danger tint 4.49 → 4.64.
     - Dark mode already passed (lowest 5.11) and is unchanged.
2. **Text below the 11 pt minimum.** Badges and chips were set at 9–10.5 px.
   - Rule: `typography.md`: "iOS, iPadOS 17 pt default, 11 pt minimum".
   - Fixed: raised to 11 px in:
     - the sidebar, top-nav and portal-nav count badges;
     - the expense confidence chip and the CRM pipeline initials;
     - the lead stage dots.
   - Printed documents keep their paper sizes.
3. **iPhone zooms the page when a field is tapped.** Inputs were 13–14 px, and Safari zooms in on any field under 16 px.
   - Fixed: one rule in `globals.css` sets form fields to 16 px below 640 px wide.
   - It covers shared and hand-written fields alike. Desktop is unchanged.
4. **Error messages disappeared on a timer.**
   - Rule: `accessibility.md`: "Minimize use of time-boxed interface elements."
   - Fixed in `components/ui/toast.tsx`:
     - Errors now stay until they are closed. Confirmations still fade after 5 s.
     - The close button is 36 px on phones.
5. **Small touch targets on phones.**
   - Rule: `accessibility.md`: 44 × 44 pt default, 28 × 28 pt minimum.
   - Fixed with a larger hit area and no visual change:
     - the dashboard task checkbox (20 → 36 px hit area; the row's layout is unchanged);
     - the task title link;
     - the hidden-salary "tap to show" button (21 → 32 px).
   - The QA sweep now measures this on every phone page (see Tests).

### High

6. **Phone tab bar showed a label only on the active tab.**
   - Rule: `tab-bars.md`: "Include tab labels to help with navigation."
   - Fixed: every tab, including More, shows its label at 11 px (`components/layout/bottom-nav.tsx`).
7. **Mixed capitalisation.** Navigation mixed Title Case ("Delivery Notes", "Bank Accounts") with sentence case.
   - Rule: `writing.md`: "Adopt capitalization rules … then apply them consistently."
   - Fixed: sentence case for every navigation label, page title and metadata.
   - Product feature names keep their capitals: Smart Inbox, Document Vault, Daily Brief, Knowledge Base, Averiqo AI.
   - Stored folder names and paper titles are data and were not touched.
8. **Three different date formats.** ISO `2026-10-18`, "18 Oct 2026" and locale strings appeared side by side.
   - Fixed: a single `showDate()` helper in `lib/time.ts` now renders "18 Oct 2026" on every list and detail screen.
   - This covers 16 files, including the public customer and supplier pages and the document renewal history.
   - Stored values are unchanged.

### Medium (left as they are; recommended next)

9. **Sales has three stacked navigation rows on phones.** The sub-menu, the page pills and the status tabs all show, which pushes
   content down. Merging them changes how people move through Sales, so it needs your decision before it is built.
10. **The floating + button overlaps the right edge of list badges** at the bottom of long lists on phones. This is cosmetic: the list
    scrolls clear of it.
11. **Dashboard density on phones.** The page is long (about 10 phone screens) and the empty-state cards are tall. A collapsible
    "more" section would shorten it.

### Low

12. **App-level theme switch.** Apple advises against one (`dark-mode.md`). It is kept because the default already follows the system
    setting, and a web app has no system-wide override for people who want one.
13. **Chart bars on the phone dashboard are 23 px wide** (12 months in 360 px). They are 202 px tall, so they remain easy to tap.

### Measured and left unchanged

**Navigation speed** (local production build with 25 ms added latency):
- Project tabs open in 63–123 ms, and main navigation in 127–276 ms.
- Links already prefetch the full page (`router.prefetch` defaults to the full kind in this app). A hover-prefetch change was tried,
  measured, showed no gain, and was reverted.
- Slowness in production comes from network distance and cold starts, not from re-renders.

**Already good:**
- visible focus rings;
- global `prefers-reduced-motion` CSS, `MotionConfig reducedMotion="user"`, and GSAP checks reduced motion before animating;
- no light or thin font weights at small sizes;
- dark mode passes contrast;
- whole-row click on lists, and skeletons for loading.

## Tests run

Every result below was run on this branch. Nothing ran against production.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (the repo's lint script) | passed |
| `npx vitest run` (unit) | 279 / 279 passed |
| `npm run test:db` (RLS and database rules) | 139 / 139 passed |
| Full `scripts/e2e.sh` (production build plus 21 browser suites) | every suite passed except one inbox check. It failed because that build read the sources before the renewal-date change; on a fresh build the inbox suite passed 49 / 49 |
| QA sweep (every page as six roles, desktop and 390 px phone) | 56 / 56 passed, 373 page views, 0 slow pages |
| Screenshot audit, desktop and phone (`audit.mjs`) | reviewed: labelled tab bar, new date format, sentence case, colours |
| Re-run after the touch-target fixes, fresh build | smoke 141 / 141, averiqo 84 / 84, service 29 / 29, portal 119 / 119, QA sweep 56 / 56 passed |

The QA sweep gained a phone touch-target check, which lists controls under 28 px. A false positive was also removed: buttons inside
collapsed `<details>` sections were being reported as unnamed.

Two things still appear in its phone list:
- the 12 dashboard chart bars (item 13);
- text links about 20 px tall inside list rows. Those rows are clickable as a whole, so the row is the real target.
