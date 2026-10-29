# Free WhatsApp sharing: payslips and salary receipts

Date: 29 Oct 2026 · Branch: `whatsapp-payslips` · Migration: `supabase/migrations/0035_whatsapp_share.sql` (additive)

## 1. Audit of what existed

| Area | What I found |
| --- | --- |
| Free sharing | Plain `wa.me` links with prefilled text: the sales editor's "Share on WhatsApp…" menu item, customer and party pages, the employee card. No PDF hand-off, no native share sheet, no way to fix a number, no record of sharing. |
| Numbers | Customers have `phone` and `whatsapp`. Employees had only `phone`. `lib/phone.ts` normalises to +971 (E.164). |
| Messages | Free links had text written inline in code. Cloud API messages use Meta-approved templates (`lib/whatsapp/messages.ts`), editable in Settings. |
| PDFs | Sales: `/api/sales/<id>/pdf`. Salary receipt: `/api/payslips/<payment>`. Statement: `/api/salary-statements/<employee>`. There was **no monthly payslip**: "payslip" meant a payment receipt. |
| Native sharing | None (`navigator.share` was not used anywhere). |
| Cloud API | `WhatsAppSend` (Meta Cloud API, PDF attached, sandbox when not connected, templates, delivery history). It was shown even when the Cloud API was not connected. |
| Gap found | The Accountant role has salary access but could not read employee records, so the Salary page showed no one to accountants. |

## 2. What changed

**Monthly payslip (new document, from the salary ledger):** `/api/salary-payslips/<month entry>`. It shows:
- employee, ID, company and month;
- basic salary;
- additions for the month;
- deductions and recoveries applied to the month;
- net salary;
- each payment allocated to the month (date, method, reference);
- what is still unpaid for the month.

It exists only for posted months. Generating or sharing it never posts salary and never marks anything as paid. The salary receipt is unchanged: a separate document per payment.

**"Share via WhatsApp" sheet (one component for every document):**
- **Recipient:** taken from the record itself (the payslip's or receipt's own employee, or the document's customer), never from a free choice.
  - It shows the name, employee ID and the number in readable groups (+971 50 111 2222), and says where the number came from.
  - It warns when the same number is saved for another employee.
- **Changing the number:** "Change" lets the admin enter another number.
  - It is validated (international format).
  - "Use for this share" leaves the profile untouched.
  - "Save to <name>'s profile" saves it, and only for users who may edit employees.
- **Missing or invalid number:** the sheet says so, and the chat cannot be opened until a valid number is entered.
- **Document:** type, number or period, file name, an in-sheet PDF preview on desktop, and a Preview link.
- **Message:** editable, prefilled from the template.
- **Phones (Android, iPhone):** "Share PDF to WhatsApp" hands the actual PDF file to the phone's share sheet.
  - The PDF is fetched as the sheet opens, so the tap opens the share sheet straight away.
  - The message is also put on the clipboard, because some apps drop the caption.
  - The sheet reminds the admin to check the chat is the right person.
- **Computers:** "Download PDF & open chat" downloads the PDF and opens that person's WhatsApp chat (`wa.me`) with the message, with a clear "attach the downloaded PDF" instruction.
- **Download PDF** and **Cancel** are always available.
- **Honest status:** after sharing it says "WhatsApp opened", never "sent". Nothing is marked as sent, delivered or paid.
- **Share log:** `document_shares` records who opened WhatsApp for which document, when and how, plus the last 4 digits of the number. The sheet shows "Opened in WhatsApp 2 times before, last 29 Oct by Owner".
- **Employee Portal:** when the employee has a login, the sheet notes they can also open the document in the portal (sign-in required). No public or permanent link is ever created.

**Where it appears:**

| Screen | Sharing added |
| --- | --- |
| Salary dashboard | Share the chosen month's payslip on every row and phone card |
| Salary account page | Payslip view and share on every month; share on every payment |
| Quick Pay | Share right after paying |
| Employee Salary tab | Share on recent payments |
| Sales editor | "Share on WhatsApp…" for quotations, invoices and delivery notes; "Share payment reminder on WhatsApp…" for unpaid invoices |
| Employee Portal | The employee's own payslip per month |

**Editable messages:** Settings → WhatsApp sharing messages. One message each for payslip, salary receipt, quotation, invoice, delivery note and payment reminder.
- Each message accepts only the placeholders its document allows; an unknown one, such as `{balance}` on a payslip, is refused.
- Salary amounts appear only where a message uses `{amount}`. The default salary receipt message does, as in the brief; the payslip message has no amounts.
- Long digit runs (IDs, accounts) are masked.

**Employee WhatsApp number:** a new optional "WhatsApp number" field on the employee form, stored as E.164. Payslips use it, or the contact number when it is empty.

**Cloud API kept separate and optional:**
- WhatsApp Business sending is unchanged for sales documents.
- On salary screens it shows (as "Business") only when the company has connected the Cloud API.
- No Meta credentials are needed for free sharing, and no paid service was added.

**Accountant fix:** staff with salary access can now read employee records (read-only policy), so the Salary page lists everyone for accountants too.

## 3. Security and privacy

- **Server checks:** every share action checks permissions on the server. Salary documents need salary access; sales documents need finance access.
- **The share log:** row-level security limits it to the same access and company. No one can edit or delete it. It never stores the full number or any document content.
- **Payslip and receipt PDFs:**
  - only for signed-in users with salary access, or the employee for their own documents;
  - a colleague's document returns 404;
  - signed out, the request goes to sign-in.
- **Number changes:** saving a number needs the employee-edit permission, and the database enforces the format.

## 4. Tests run (none against production)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | passed |
| Unit tests | 296 / 296 passed, including 8 new sharing tests (templates, placeholders, masking, numbers, chat links, portal paths) |
| DB tests (all migrations on a fresh Postgres) | 165 / 165 passed, including 4 new tests: accountant reads employees, WhatsApp number format and who may change it, share log access / immutability / company isolation, balances unchanged |
| New `tests/e2e/share.mjs` (production build, real browser) | 40 / 40 passed |
| Full `scripts/e2e.sh` (production build plus 23 suites) | every suite passed: smoke 141, inbox 49, sales 43, ai-reader 54, print 65, erp 59, averiqo 84, operations 63, advanced 41, portals 50, service 29, platform 51, extras 34, WhatsApp 49, project-payments 48, payments-status 56, demo 38, stock-bank 30, expenses 64, portal 119, salary 45, share 40, QA sweep 56 |

The new e2e suite checked each of the following:

1. **Sharing a payslip from the salary account page (desktop):**
   - recipient Ali Hassan, W-01, +971 50 111 2222 from the profile;
   - the payslip file name;
   - a message with no salary amount;
   - the duplicate-number warning;
   - the PDF preview;
   - the PDF downloaded;
   - Ali's `wa.me` chat opened with the edited message;
   - "never sent" wording;
   - the share logged with the last 4 digits only.
2. **Sharing a salary receipt from payment history:** the amount and date in the message, the receipt number, and the receipt PDF contents.
3. **A payslip after several partial payments:**
   - basic and net salary 3,000.00;
   - both payments for the month (500 and 700) listed;
   - 1,800.00 still unpaid;
   - the 2,000 that settled the opening balance not shown as paid for the month;
   - no new salary entry created.
4. **The correct employee's number:** taken from the record. A number shared with another employee is flagged.
5. **Missing and invalid numbers:**
   - no number: the chat is blocked;
   - an invalid number is refused;
   - "Use for this share" leaves the profile unchanged;
   - the number is saved only on "Save to Sara's profile".
6. **Phone sharing:** the phone share sheet receives the actual payslip PDF (file name, `application/pdf`, starts with `%PDF-`) and the message. The share is logged and the sheet fits a 390 px screen.

   The browser's share sheet is simulated in the test (headless Chromium has no share sheet). A real Android phone was not used, so test that by hand.
7. **Desktop WhatsApp:** PDF download plus `wa.me` chat, as in 1.
8. **PDF contents:** checked as in 1–3.
9. **Balances:** owed amount, payments and ledger entries are identical before and after sharing.
10. **Sales sharing:**
    - quotation sharing works through the new sheet (customer WhatsApp number, quotation message, PDF, chat);
    - the existing "shared on WhatsApp" document event is still recorded;
    - the WhatsApp Business "Send" button is still there;
    - the WhatsApp Business suite passed 49 / 49.
11. **Roles and companies:** covered by the DB tests and by the employee checks in the e2e: an employee gets their own payslip, and a colleague's returns 404.
12. **Nothing public:** signed out, a payslip request redirects to sign-in, and no file is returned.

**Settings:** an edited payslip message is used; a placeholder the document lacks (`{balance}`) is refused.

## 5. Still to do

- **Run migration 0035 in Supabase before merging.** The new code reads `employees.whatsapp` and `document_shares`.
- **Test on a real Android phone once.** In the share sheet, WhatsApp should show and the PDF should arrive in the chat. This was not possible from here.
- **Optional:** add WhatsApp numbers to employees in their profile, or the first time you share.
