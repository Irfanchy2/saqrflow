# Employee claims: select all and approve together · red dot on Expenses · faster receipt OCR

Date: 31 Oct 2026 · Branch: `claims-bulk-ocr-turbo` · No database change, no migration.

## 1. Select all and approve together (Expenses → Employee claims → Waiting)

- **Selecting:**
  - every waiting claim has a checkbox, with **Select all (N)** at the top;
  - a bar appears showing **N selected · total AED**, an optional **Paid back from** account and **Approve N · add to expenses**;
  - one confirm step follows ("Confirm: approve N"); on phones the bar sits above the tab bar, within thumb reach.
- **Left out of Select all:**
  - **your own claims** cannot be ticked, because another approver decides them;
  - **possible duplicates** (same supplier and receipt number as a saved expense or another live claim) are flagged in red. They can still be ticked by hand after checking.
- **Safe:**
  - every claim is approved through the same database function as a single approval, so the same permission checks apply;
  - your own claims are refused and each claim is added to expenses exactly once;
  - each claim keeps the employee's own category, project, receipt and amounts;
  - a claim that cannot be approved is skipped and named, and the rest still go through;
  - to change a category or project, or to send a claim back, open it as before.

## 2. Red dot beside Expenses when claims are waiting

- **Where it shows:** wherever Expenses appears for an approver:
  - the Finance section tabs;
  - the group menu;
  - the sidebar;
  - the phone tab bar: on the **Expenses** tab when it is shown, otherwise on **More**, which contains Expenses.
- **Finance tab count:** the count on the Finance tab includes the waiting claims.
- **What it counts:** only claims this person can approve (their own are left out). The dot disappears once nothing is waiting for them.
- **Who sees it:** only people who can approve expenses, i.e. finance access plus approval rights.

## 3. Faster receipt OCR (free, on our own server; no Google needed)

**Measured on production (Vercel logs, 31 Oct):** most scans took **33–47 s**; one took 2.5 s.

**Measured here on one CPU core:**

| Step | Time |
| --- | --- |
| Tiny PaddleOCR models | 2.6 s |
| Small models | 8 s |
| Full-size contrast-evened pass | 20 s |
| Model load | 1 s tiny, 9.6 s both |

When the first reading was unsure, the old plan ran the 8 s and 20 s passes. They rarely read more, and OCR.space and Gemini only started after them.

**Turbo v2:**
- **Tiny passes only:** tiny models on the photo, then tiny again with the contrast evened (faded or shadowed paper), about 3 s each. The small models run only when the tiny ones found almost no text. The 20 s full-size pass is gone from turbo mode; switching turbo off in Settings still gives the detailed mode.
- **OCR.space in parallel:** OCR.space (free, already your cloud reader) starts as soon as the first on-server reading is unsure, instead of after all local passes.
- **The form fills earlier:** the reading appears as soon as the on-server reading is done.
- **Gemini capped:** still only when nothing else gave a good reading and your settings allow AI, now with a **15 s cap**.
- **Faster first scan:** the warm-up when you tap Scan receipt loads the tiny models first (about 1 s), and the small ones follow in the background.

**Before and after, one CPU core, warm server:**

| Receipt | Before | After |
| --- | --- | --- |
| Clear phone photo (18 items) | 2.1 s | 2.2 s |
| Faded / shadowed photo | 1.8 s | 1.9 s |
| Unsure reading (part of the receipt missing) | **35.1 s** | **5.4 s** (same reading; OCR.space starts at 2.2 s) |

**About Google:**
- Your company settings currently use OCR.space (free) for cloud OCR and **Gemini (Google) for the AI check**.
- To never use Google, open Settings → AI & Automation and set the AI reader to rules only (no AI). The scan then uses only PaddleOCR on our server plus OCR.space.
- I have not changed that setting for you.

## 4. Tests actually run (nothing against production)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | passed |
| Unit tests | 299 / 299 (new: an unsure receipt stops after two quick passes and asks for cloud OCR after the first) |
| DB tests | 167 / 167 |
| New `tests/e2e/claims-bulk.mjs` | 24 / 24 |
| `expenses.mjs` (scanning flows) and `portal.mjs` (claims) | 64 / 64 and 119 / 119 |
| Full `scripts/e2e.sh` (production build plus 24 suites) | Every suite passed, including claims-bulk 24, expenses 64, portal 119, share 119, salary 45 and QA sweep 56, except one Platform check: the known intermittent React #418, on `/settings`, which this change does not touch. Platform passed 51 / 51 on one re-run. |

**`claims-bulk.mjs` covers:**
- **Red dot:**
  - "4 waiting" on Expenses, with the owner's own claim not counted;
  - no dot elsewhere;
  - Finance shows 4;
  - on the phone: the dot is on More from Home and on Expenses on the claims page;
  - the dot clears when only the approver's own claim is left.
- **Select all:**
  - Select all covers 3, leaving out the duplicate and the own claim;
  - total AED 830.55;
  - confirm step, then 3 approved with exactly one expense each, keeping employee, amounts and category;
  - audit trail written once each;
  - the duplicate is approved only when ticked by hand.
- **Phone layout:** the approve bar sits above the tab bar.

**Not tested:** a real phone or the production server's speed after deploying. Please check the scan time on your phone once this is live.
