# Petty cash attachments · employee "add money" fix · Log in as employee

Date: 1 Nov 2026 · Branch: `petty-attach-impersonate` · Migration: `0038_petty_cash_attachments.sql` (run it before merging)

## 1. Why "add money from the employee side" was not coming

Read-only check on production:

- Only one hand-over had been issued (AED 1.00 to Mohammad Irfan Chowdhury), and no employee report existed.
- The employee's own session could see the balance and was allowed to file a report. The database was fine.

**Cause:** the option was hard to find.
- The petty cash card on the portal's Home and My expenses only appeared once the employee already had petty cash.
- Without it, the only way in was a small text link on My expenses. Mohammed Ayub (no petty cash yet) never saw it.

**Fix:** the **Petty cash card is now always shown**, on both Home and My expenses.
- It shows the balance (AED 0.00 to start) and what is waiting.
- It carries an **Add petty cash received** button and **Open petty cash**.

## 2. Supporting attachments

**Where you can attach a file:**
- **Issue petty cash** (admin): optional photo or PDF of the voucher or transfer slip.
- **Add petty cash received** and **Return unused petty cash** (employee): optional photo or PDF.
- **Correcting a report** that was sent back: a new file can be attached.

**How files are checked and stored:**
- Each file is checked before anything is saved: its real type is read from its bytes, the size limit is 15 MB, and active content is refused.
- The file is stored in the Vault as a petty cash document of that employee.
- A refused posting leaves no orphan file behind.

**Where the attachment shows:**
- the admin's report detail (**Open attachment**);
- the wallet statement row (paperclip);
- the employee's history.
Confirming a report carries its attachment onto the ledger entry.

**Who can open it:** the employee (their own only), petty cash managers and finance. Enforced in the database (`can_view_document`).

**Database rules (0038):**
- A report may carry only a petty cash attachment filed for the employee who reports it.
- Issue petty cash accepts only an attachment filed for that employee, in the same company.

## 3. Log in as employee

**Where:** on each employee card (Employees) and in the employee's **Portal access** box, the button **Log in as employee** opens that person's portal as them.

**Who can use it, on whom:**
- Only users who manage users (owners); checked on the server.
- Only on an **active Employee login of the same company**. Never an owner, accountant, HR or other manager login, and never your own.

**While switched:**
- An amber bar says **"Viewing as <employee>. Signed in by <owner>; what you do here is recorded."**
- The employee's limits apply: admin pages stay closed.

**Back to admin:**
- **Back to admin** signs the employee session out and restores the owner session. No password is needed.
- The owner's own session is kept while switched in an **encrypted, httpOnly** cookie that the page cannot read. It lasts at most 8 hours.
- **Signing out while switched** ends both sessions; nothing is left signed in.

**Audit and limits:**
- Every start and end is written to the audit log: owner, employee, duration.
- At most 30 switches per hour.

**Note:** anything done while switched (for example submitting an expense) is recorded as the employee, with the start and end of the switch in the audit log.

## 4. Tests actually run (nothing against production)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | passed |
| Unit tests | 310 / 310 |
| DB tests | 198 / 198 (3 new: who opens petty cash attachments; reports only with the employee's own attachment; Issue petty cash only with this employee's attachment) |
| New e2e `tests/e2e/petty-extra.mjs` | 26 / 26 (see below) |
| Full `scripts/e2e.sh` (production build + 26 suites) | all passed, exit code 0 (incl. portal 119, salary 45, share 119, claims-bulk 24, petty 47, petty-extra 26, QA sweep 56) |

**What `petty-extra.mjs` covers:**
- **Petty cash card:** on Home with AED 0.00 for an employee with no petty cash.
- **Attachments:**
  - a report with an attachment, filed correctly;
  - the admin opens it;
  - Issue petty cash with an attachment, shown on the statement;
  - the employee opens their own attachments but not another employee's.
- **Log in as employee:**
  - offered only for Employee logins;
  - the owner lands in the portal with the banner and sees the employee's balance;
  - admin pages are closed while switched;
  - start and end are in the audit log;
  - Back to admin restores the owner;
  - the cookie is encrypted, httpOnly and cleared afterwards;
  - signing out while switched leaves nobody signed in.

**Not tested:** production. Please try **Log in as employee** once it is live. Production uses the real Supabase sign-in link; the tests use a stand-in.
