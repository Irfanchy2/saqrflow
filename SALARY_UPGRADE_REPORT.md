# Salary accounts upgrade report

Date: 29 Oct 2026 · Branch: `salary-ledger` · Migration: `supabase/migrations/0034_salary_ledger.sql`

## 1. What was wrong

**The "already recorded" warning on a second payment.**
`salary_payments` had a database rule, `unique (employee_id, period)`, so one employee could have only ONE payment per month.
`addSalaryPayment` turned the refusal into the message "Salary for … is already recorded".

Live data shows how this was being worked around:
- Employee E-004 (salary AED 1,500) has two payments, AED 2,000 and AED 1,000.
- Both were paid in October.
- The second was filed under November to get past the rule.

**No record of what is owed.** The system stored payments only:
- There was no salary accrual, no opening balance and no running balance.
- It could not say how much an employee is still owed, and nothing carried forward from month to month.

**Advances.** Advances were counted in full until someone ticked "settled":
- Nothing recorded a partial recovery from salary.
- The old payslip PDF subtracted any "deduction" advance from the same month from the payment, which mixed the two concepts.

Read-only check of the live database (no changes were made):

| Item | Count |
| --- | --- |
| Companies | 3 |
| Employees | 14 |
| Employees with a salary | 8 |
| Salary payments | 2, both employee E-004 |
| Advances | 2: E-004 and E-008, AED 2,000 each, not settled |

There are no accruals or opening balances, because neither concept existed.

## 2. What changed

### Database (migration 0034, additive and safe for live data)

- **The one-payment-a-month rule is removed.** Every existing payment row is kept.
  - New columns: `reference`, `status` (default `posted`), the reversal fields, `created_by`, `allocate_to` and `idempotency_key`.
  - The `idempotency_key` is unique per company, so a double-clicked or resubmitted form is saved once while real extra payments are allowed.
  - New payments must be more than 0. The rule is `NOT VALID`, so existing rows are untouched.
  - Payment method "Other" is added.
- **`salary_ledger` records what is owed.** Entry types:

  | Entry | Rule |
  | --- | --- |
  | `opening` | One per employee. A correction reverses the old entry, with a reason. |
  | `accrual` | One per employee per month. The amount is copied when posted, so a later salary change never alters it. |
  | `adjustment` | Signed. A reason is required. |
  | `deduction` | A reason is required. |
  | `advance_offset` | Recovers an advance. Capped at what is left of that advance. |

  - Posted entries cannot be edited. A mistake is reversed (status `reversed`, reason required, who and when recorded) and entered again.
- **`salary_allocations` records which payment settled which period.**
  - The oldest unpaid period is settled first: the opening balance, then month by month.
  - A payment can instead be aimed at a chosen period.
  - Allocations are rebuilt by the database whenever an employee's ledger or payments change, so they always reconcile with the balance, including after a reversal.
  - Money paid beyond what is owed stays as a credit, which the next month absorbs.
- **Balances are calculated, never stored.** The views (all RLS-aware):
  - `salary_accounts`: per employee, opening + accrued + additions − deductions − recoveries − payments = outstanding;
  - `salary_obligations`: each period with paid, left and status;
  - `employee_advance_balances`: each advance with recovered and remaining.
- **Database functions:**
  - `salary_post_month(month, employees[])` posts a month and skips anyone already posted, so running it twice posts nothing twice;
  - `salary_set_opening(...)` sets or corrects the opening balance, and refuses an opening balance that would cover months already posted (no double counting).
- **Permissions:**
  - Read and write need `salary.view`: owners, HR managers and accountants.
  - Employees read only their own ledger and allocations, never the change history.
  - Nobody can delete a payment or a ledger entry from the app. They are reversed instead.
  - Companies are isolated.
- **History:**
  - `salary_audit` keeps every posting, edit and reversal with before and after values and the reason. Only salary access can read it.
  - The general audit log stays redacted (no salary amounts), as before.
- **Nothing is assumed about history.** No opening balance or accrual is created for anyone. Admins set them in the app.

### App

- **Salary dashboard (`/salary`, under People).**
  - Summary cards: total owed today, paid in the chosen month, salary added in the chosen month, and employees owed.
  - Month picker.
  - Employee table: monthly salary, earlier months, this month, total owed, paid this month, status, Pay, Statement.
  - Table tools: search, a Paid / Partially paid / Unpaid filter, and sorting (highest owed, name, paid).
  - Phones get one card per employee.
  - "Post <month> salary" shows a preview of who gets what, then posts on confirmation.
- **Quick Pay.**
  - The sheet shows total owed, earlier months and this month, and suggests an amount, with one-tap chips.
  - Fields: date (today), method, and optional reference and notes.
  - It previews which periods the payment will settle.
  - An "Advanced" section can settle a chosen month first.
  - After saving, it shows the new balance from the database and offers Print receipt and Download receipt.
  - "Record another" starts from the new balance.
- **Salary account page (`/salary/<employee>`):**
  - overview (still owed, monthly salary, total owed so far, total paid);
  - month-by-month table (salary, paid, left, status, reverse);
  - opening balance;
  - payments (method, periods settled, reference, notes, who recorded it, status, receipt, WhatsApp, edit details, reverse);
  - advances (give, recover from salary);
  - additions, deductions and recoveries;
  - statement with a date range (on screen, print or PDF);
  - history.
- **Opening balance reconciliation.** The admin can enter either:
  - what was owed before the records start; or
  - what is still owed today. The app then works out the opening entry from what is already recorded, so existing payments are neither lost nor double counted.
- **Receipts.** The salary receipt PDF (replacing the payslip) shows:
  - company letterhead, employee and ID;
  - receipt number, date, method and reference;
  - the periods settled;
  - the amount, also in words;
  - the salary still owed after this payment;
  - a signature line.

  Reversed payments are marked on the receipt. WhatsApp sending keeps working.
- **Statement PDF.** It shows the balance brought forward, every movement with a running balance, and the closing balance. Long statements continue onto more pages.
- **Employee Portal.** Employees see:
  - salary owed to them;
  - month by month;
  - payments with receipts;
  - their statement (PDF);
  - advances with what is left to repay.

  The portal home shows "Salary owed to you". Employees cannot change anything.
- **Employee page, Salary tab.** It now shows a summary of the account with Quick Pay, Statement and the salary account link. Monthly salary editing stays here.

## 3. Your live data after the migration

Nothing changes until an admin acts:
- The two E-004 payments stay as they are.
- With no salary months or opening balance posted, E-004 shows as paid ahead by AED 3,000.
- To fix this, open Salary → E-004 → Set opening balance, choose **Still owed today**, and enter what the company really owes now. The app calculates the rest.
- Then post the current month from the Salary page.
- The two open advances (E-004, E-008) appear under Advances with AED 2,000 to repay. Recover them from salary when you choose.

## 4. Tests run (all on this branch, none against production)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (the repo's lint script) | passed |
| Unit tests (`npx vitest run`) | 288 / 288 passed, including 9 new salary tests |
| DB tests (`npm run test:db`, all migrations applied to a fresh Postgres) | 161 / 161 passed, including 22 new salary tests |
| New `tests/e2e/salary.mjs` (production build, real browser, desktop and 390 px phone) | 45 / 45 passed |
| Full `scripts/e2e.sh` (production build plus 22 suites) | 21 suites passed in full; QA sweep 56 / 57, see below |
| QA sweep re-run on its own, fresh build | 56 / 56 passed |

The salary database tests cover:
- scenarios A–J;
- one accrual per month;
- idempotency;
- later salary changes not altering posted months;
- reversals and the rule that nothing can be deleted;
- the opening-balance guard;
- advance offsets;
- who can read and write;
- the employee seeing only their own account;
- company isolation;
- audit redaction.

The salary e2e suite covers:
- opening balance;
- posting a month with preview, and posting it twice;
- two payments on the same day, then four in one day;
- oldest-first allocation, and a payment aimed at a chosen month;
- reversal with its reason;
- advance recovery;
- a deduction;
- the statement on screen and as PDF;
- the receipt PDF and printing;
- legacy payments reconciled;
- filters and cards;
- the phone layout and the Quick Pay sheet;
- the employee's own view, with a colleague's statement refused.

Full-run figures by suite:

| Suite | Passed |
| --- | --- |
| smoke | 141 |
| inbox | 49 |
| sales | 43 |
| ai-reader | 54 |
| print | 65 |
| erp | 59 |
| averiqo | 84 |
| operations | 63 |
| advanced | 41 |
| portals | 50 |
| service | 29 |
| platform | 51 |
| extras | 34 |
| whatsapp | 49 |
| project-payments | 48 |
| payments-status | 56 |
| demo | 38 |
| stock-bank | 30 |
| expenses | 64 |
| portal | 119 |
| salary | 45 |

The one QA-sweep miss in the full run:
- What happened: an employee on a phone opened `/print/qr`, was sent back to `/me`, and that page logged React hydration error #418 once.
- It did not reproduce: the sweep passed 56 / 56 when re-run.
- Every other redirect to `/me` in the same run was clean.
- `/me` renders its clock from the server time.
- This looks like the known intermittent #418, not this change, but it is reported here rather than hidden.

Tests changed because the screens moved:
- `smoke` now pays salary with Quick Pay.
- `portal` adds an advance from the salary account page.
- `whatsapp` checks the new receipt PDF instead of the old payslip.

## 5. Still to do

- **Apply migration 0034 to production.** It is additive: it drops one unique rule and adds tables, columns, views and functions. No data is changed.
- **After that**, set opening balances for the employees who are owed salary, and post the current month.
- **Not built:**
  - WPS (SIF) file export, which was already marked as planned and needs the bank's specification;
  - automatic monthly posting on a schedule (posting stays a deliberate admin action with a preview, as asked);
  - splitting an opening balance into the individual months it covers (it is one oldest obligation unless entered as adjustments with months).
