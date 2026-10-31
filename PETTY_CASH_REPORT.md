# Employee Petty Cash: business expense wallet and settlement

Date: 31 Oct 2026 · Branch: `petty-cash` · Migration: `0037_petty_cash.sql` (additive; run it before merging)

Petty cash is company money an employee holds for business purchases. It is kept fully separate from salary, salary advances, payslips and payroll: no petty cash code reads or writes a salary table, and a test proves the salary tables are byte-for-byte unchanged.

## 1. What was found (audit, read-only on production)

- **Claims:** 9 employee expense claims, all approved (5 cash, 4 card, 2 of those on a company card).
- **Accounts:** one company account (current account) and no cash account.
- **Companies:** 3.
- **Existing records:** none are reclassified. Earlier claims keep "payment source" empty (shown as *Not stated (earlier claim)*) and work exactly as before.
- **Salary:** `salary_payments`, `employee_advances` and `salary_ledger` are untouched.

## 2. Database (`0037_petty_cash.sql`, safe to re-run, no data changed)

**New ledger: `petty_cash_entries`.** Every row is posted once and never edited or deleted. Corrections are reversal rows or adjustment rows.

- **Types:** PETTY_CASH_RECEIVED, BUSINESS_EXPENSE_SETTLED, PETTY_CASH_RETURNED, AUTHORIZED_ADJUSTMENT, REIMBURSEMENT_PAYABLE, REIMBURSEMENT_PAID, TRANSACTION_REVERSAL.
- **Two books:**
  - the *wallet* (available petty cash);
  - *reimbursement* (money the company owes the employee for expenses paid with their own money).
  Reimbursements never change the petty cash balance.
- **Duplicate protection:**
  - a unique `source_event` per company;
  - an advisory lock per employee wallet;
  - a request key per form.
  Retries, double clicks and concurrent approvals post once.
- **Never negative:** returns, settlements, adjustments and reversals are refused if they would take the wallet below zero.
- **Immutable:** a trigger blocks any update or delete of a posted row, even by the service role.

**New table: `petty_cash_requests`** holds employee reports (money received, returns).

- A report is pending until an approver confirms it. Statuses: approve, reject, or request correction.
- A "received" report can be **matched to a hand-over the company already recorded**. It is then linked, not credited again, and the same hand-over cannot be matched twice.

**New column: `expense_claims.funded_by`**, the payment source: company petty cash, own money, or company direct. It is optional.

- A company-card claim can only be "company" (enforced by a check constraint).

**Balances are computed, never stored:**
- the `petty_cash_wallets` view (per employee);
- the `expense_claim_settlement` view (per claim: settled from petty cash, owed back, still to settle).

**Functions:** `petty_issue`, `petty_decide_request`, `petty_record_return`, `petty_settle_claim`, `petty_reimburse`, `petty_adjust`, `petty_reverse`.

**`decide_expense_claim`** gained two optional settlement amounts. Earlier and company-paid claims behave exactly as before.

**Cash flow (company accounts):**

| Scenario | Company cash | Petty cash | Expense |
| --- | --- | --- | --- |
| A. Issue AED 1,000 | −1,000 (once, the account chosen) | +1,000 | 0 |
| B. Expense AED 300 approved from petty cash | 0 (no second movement) | −300 | +300 |
| C. Return AED 200 confirmed | +200 | −200 | 0 |
| D. Own money AED 250 approved | 0 | 0 | +250, owed back 250 |
| E. Reimbursement AED 250 paid | −250 | 0 | no second expense |

**Security:**
- RLS: an employee sees only their own wallet, reports and entries; managers and finance see their company only.
- No write access to the ledger except through the functions.
- Every function checks permission and company again.
- Signed-out callers get nothing.
- Audit triggers on both tables.
- Approvers are notified of new reports, and the employee is notified of each decision.

## 3. Admin screens

**Expenses → Petty cash** (new tab, with a count badge):
- **Overview:** outstanding petty cash, distributed, expenses settled, reimbursements due, reports to confirm, pending petty cash expenses.
- **To confirm:** each report shows its details and the employee's balance. For a "received" report it suggests matching recorded hand-overs (same amount, same reference or within a week). Approve, send back for a correction, or reject (a reason is required).
- **Approved expenses waiting for settlement**, each with a **Settle** action.
- **Wallets:** a table with search.
- **Transactions:** filters for employee, type, project and date range, plus **CSV** export.
- **Issue petty cash:** employee, amount, date, method, account it came from, project, purpose, reference, notes.

**Employee wallet page** (`/expenses/petty-cash/<employee>`):
- **Balance cards.**
- **Actions:** Issue, Record return, Pay reimbursement (full or partial), Adjust (with a reason).
- **Petty cash statement:** period, opening balance, running balance, closing balance, and **Reverse** on each row (the row stays and an opposite row is added).
- **Statement output:** PDF (view or download) and **free WhatsApp share** (`petty_cash_statement`, reusing the working PDF attachment sheet).
- **Reimbursements section** and the **reports history**.

**Claim approval:**
- The claim shows *Paid from* and the petty cash held.
- **Petty cash claims:**
  - defaults to settling as much as the employee holds;
  - any part the approver confirms the employee paid can be recorded as owed back;
  - the rest is left awaiting settlement (the employee is never assumed to have paid).
- **Own-money claims:** recorded as owed back, with an optional "pay back now from" account.
- **Bulk approve** uses the same defaults.

**Red dot and Approval Center:** the red dot beside Expenses and the Finance count include petty cash reports waiting (the approver's own are left out), and the Approval Center shows a banner linking to the queue.

## 4. Employee portal (phone first)

- **Wallet card** on Home and My expenses, linking to **Petty cash** (`/me/expenses/petty-cash`):
  - available balance, with pending expenses shown separately and not deducted;
  - received / spent / returned;
  - pending expenses, reports waiting, amount to be paid back, amount awaiting settlement;
  - history with a running balance.
- **Actions:**
  - Add a business expense (scan, upload or by hand);
  - **Add petty cash received**;
  - **Return unused petty cash** (cannot exceed what they hold);
  - download their **statement PDF**.
- **Reports:** pending or sent-back reports can be changed or withdrawn.
- **Expense form:** gained **Paid from** (Company petty cash / My own money / Company paid directly). It preselects petty cash when the employee holds some. A company card always counts as company money.
- **Isolation:** employees cannot open the admin pages, the company CSV, or another employee's statement.

## 5. Tests actually run (nothing against production)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (the repo's lint) | passed |
| Unit tests | 310 / 310 (new `petty.test.ts`: balance formula, statement, matching, default settlement, portal access) |
| DB tests | 195 / 195 (new `tests/db/petty.test.ts`, 28 tests) |
| Migration re-run | applied twice in a row: all tests still pass |
| New e2e `tests/e2e/petty.mjs` (desktop and phone) | 47 / 47 |
| Full `scripts/e2e.sh` (production build + 25 suites) | all passed, exit code 0: smoke 141, inbox 49, sales 43, AI reader 54, print 65, ERP 59, Averiqo 84, operations 63, advanced 41, portals 50, service 29, platform 51, extras 34, WhatsApp 49, project payments 48, payments 56, demo 38, stock & bank 30, expenses 64, portal 119, salary 45, share 119, claims-bulk 24, petty 47, QA sweep 56 |

**DB tests cover the brief's test cases 1–10:**

| Case | What is checked | Expected result |
| --- | --- | --- |
| 1 | Issue 1,000, settle a 250 expense | 750 |
| 2 | Employee report, before and after approval | balance unchanged before, +500 after; linked to an existing hand-over, never credited twice |
| 3 | Rejected expense | no deduction |
| 4 | 350 expense with 200 held, split | wallet 0, reimbursement due 150; overspending refused, the shortfall awaits settlement |
| 5 | 1,000 received, 650 spent, return in parts | 0, company cash +350 |
| 6 | 250 paid with own money | wallet unchanged, 250 due |
| 7 | Pay back 100 of 250 | 150 remaining |
| 8 | Duplicate and concurrent approvals | one settlement entry |
| 9 | Another employee, another company | access denied |
| 10 | Payroll isolation | salary tables unchanged |

**Further DB checks:**
- multiple issues in one month, multiple expenses on one day, multiple partial returns;
- reversals and adjustments;
- project allocation;
- notifications;
- cash flow;
- the immutable ledger;
- the audit log;
- WhatsApp share permission.

**The e2e suite checks:**
- the full admin → employee → admin flow in the browser;
- red dot "3 waiting" and the Approval Center banner;
- statement PDF text, CSV, the WhatsApp sheet;
- employee isolation;
- unchanged salary tables;
- no sideways scrolling on phones.

## 6. Not done / limits (honest list)

- **Supporting attachments** on Issue petty cash and on employee reports are not implemented (expense receipts work as before). Adding them needs a new document owner type.
- **Separate report PDFs** (distribution, settlement, outstanding, pending, reimbursement, project, returns) are covered by the **filtered CSV** and the per-employee **statement PDF**, not as eight separate PDF layouts.
- **Approval Center:** petty cash reports appear as a banner linking to the petty cash queue, not as rows inside the Approval Center list.
- **Not tested:** a real phone, and production after deploying.
