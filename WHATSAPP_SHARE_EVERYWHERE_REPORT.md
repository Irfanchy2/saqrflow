# One WhatsApp PDF sharing system across Averiqo

Date: 29 Oct 2026 · Branch: `whatsapp-share-everywhere` · Migration: `supabase/migrations/0036_share_more_documents.sql` (additive)

## 1. Audit of the working payslip sharing (the reference)

| Step | How it works | File |
| --- | --- | --- |
| PDF generation | Each document has one signed-in PDF endpoint; Download, Preview and sharing all use it, so the shared file is the downloaded file. | `app/api/...` |
| Recipient and number | Taken from the record itself: the payslip's employee, the document's customer. WhatsApp number first, then the contact number, normalised to +971… (E.164). | was `app/actions/share.ts`, now `lib/whatsapp/share-docs.ts` |
| Message | Per-type template, editable in Settings, filled from the record. Unknown placeholders are refused. | `lib/whatsapp/share.ts` |
| Attaching the PDF | The sheet fetches the PDF when it opens and checks it is a real PDF. The tap calls `navigator.share({ files: [pdf] })`, file only, and copies the message to paste as the caption. | `components/whatsapp/share-sheet.tsx` |
| Android / phone browsers | The phone's share menu with the PDF. The admin picks WhatsApp and the chat. The sheet says to check it is the right person. | same |
| Computers | Where the browser cannot share files: download the PDF and open that person's chat with the message. The sheet says plainly that the PDF must be attached by hand. | same |
| Log | `document_shares` records that WhatsApp was opened (intent only, never "sent"), with the last 4 digits of the number. | migration 0035 |

**Where sharing was missing or inconsistent:**
- salary statements, customer statements, customer payment receipts and employee files had a PDF but no free sharing;
- the sales lists had no share action;
- the invoice list's "Send via WhatsApp" was the paid WhatsApp Business button;
- the editor's desktop toolbar had only the Business button;
- on the customer page, ledger and payments list, the Business buttons were the only WhatsApp action.

## 2. What changed

**One reusable system:**
- **`lib/whatsapp/native-share.ts`:** the browser side for every document. It contains:
  - `canShareFiles`;
  - `loadPdf`, which fetches the PDF and refuses anything that is not a real `application/pdf` starting with `%PDF-`;
  - `shareDocumentViaWhatsApp({ file, message })`, which shares the file only and copies the message;
  - `copyText`.
- **`lib/whatsapp/share-docs.ts`:** one resolver per document type: recipient, number, PDF endpoint, file name and message values. Reads go through the user's own session, so row-level security keeps them inside the company and the user's access.
- **`components/whatsapp/share-sheet.tsx`:** the one "Share via WhatsApp" sheet. It shows:
  - the document type, number and file name;
  - the recipient's name and number;
  - an editable message;
  - Share PDF, Download PDF, Copy message and Cancel.
- **`lib/whatsapp/share.ts`:** templates and placeholders for every type, plus who may share each type (`sharePerms`, mirrored in the database).

**Document types that can be shared:**

| Type | Recipient | Who may share | PDF |
| --- | --- | --- | --- |
| Payslip (month) | Employee | Salary access | `/api/salary-payslips/<month entry>` |
| Salary payment receipt | Employee | Salary access | `/api/payslips/<payment>` |
| **Salary statement** (new) | Employee | Salary access | `/api/salary-statements/<employee>` |
| Quotation / Tax invoice / Delivery note | Customer | Finance access | `/api/sales/<id>/pdf` |
| Payment reminder (unpaid invoice) | Customer | Finance access | the invoice PDF |
| **Customer payment receipt** (new) | Customer | Finance access | `/api/payment-receipts/<payment>` (new route, same receipt as WhatsApp Business) |
| **Customer statement of account** (new) | Customer | Finance access | `/api/statements/<customer>` |
| **Employee document** (new; PDF files only, e.g. contract, visa copy) | That employee | Documents + sensitive employee data | `/api/documents/<id>/download?mode=preview` |

**Where "Share via WhatsApp" now appears:**

| Screen | Action |
| --- | --- |
| Quotations / Delivery notes list | Share icon on each row |
| Tax invoices list | Share icon on each row; row menu: Share via WhatsApp, Share payment reminder (if unpaid), Send with WhatsApp Business |
| Quotation / invoice / delivery note editor (preview included) | Desktop toolbar **Share**; phone action bar green WhatsApp button; More menu: Share on WhatsApp, Share payment reminder |
| Invoice page, payments | Share receipt on each payment |
| Sales → Payments list | Share receipt on each payment |
| Customer page | Share statement; Share receipt on each payment |
| Customer ledger | Share statement |
| Salary dashboard / salary account / Quick Pay / employee salary tab | Payslip and receipt (unchanged); salary account statement: **Share** |
| Employee → Documents | Share on each PDF (images and other files are not offered) |

**WhatsApp Business (paid Cloud API) is kept separate.** Its buttons stay where they were, now labelled "Business" or "Send with WhatsApp Business", so they are not mistaken for free sharing.

**Not added, on purpose:**
- **Project reports:** there is no project report PDF, and the existing project update is a text message for WhatsApp Business.
- **Document expiry notifications:** these are reminders without a document. The expiring PDF itself can now be shared from the employee's Documents tab, and WhatsApp Business still sends the expiry reminder.
- **Cheque reminders:** no document.
- **Supplier documents (purchase orders):** no supplier WhatsApp number flow exists. Can be added the same way if wanted.

## 3. Security

- **Server-side checks:** every type is checked on the server with the same permissions as its PDF: salary, finance, or documents plus sensitive employee data.
- **Database rule:** migration 0036 adds the same rule to the share log (`share_kind_allowed`). Another role or company cannot read or write those rows.
- **No public links:** PDFs are fetched by the signed-in browser and handed to the share menu. Signed out, the new receipt route returns no PDF.
- **Not marked as sent:** nothing is marked as sent, delivered or paid. "Opened in WhatsApp" is all that is recorded.
- **Recipient comes from the record:** a number can be changed for one share, and saved to the profile only with edit rights.

## 4. Migration 0036 (run in Supabase before merging)

Additive, and safe to re-run:
- It widens the allowed document types on `document_shares`. The old list is a subset, so existing rows still pass; production currently has 4 shares, all kept.
- It updates `share_kind_allowed()`.
- No data is changed or removed.

## 5. Tests actually run (none against production)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | passed |
| Unit tests | 298 / 298 (new: permissions per type; statement and receipt messages carry no salary amounts) |
| DB tests (all migrations on a fresh Postgres) | 167 / 167 (new: each new type logged only with the matching role, not by another company, unknown types refused, old shares kept) |
| `tests/e2e/share.mjs` (production build, real Chromium) | 119 / 119 |
| Full `scripts/e2e.sh` (production build plus 23 suites) | Every suite passed except one check: smoke 141, inbox 49, sales 43, ai-reader 54, print 65, erp 59, averiqo 84, operations 63, advanced 41, portals 50, service 29, platform 51, extras 34, WhatsApp Business 49, project-payments 48, payments-status 56, demo 38, stock-bank 30, expenses 64, portal 119, salary 45, share 119. The QA sweep failed one check: the known intermittent React #418 on HR manager's `/inbox`, a page this change does not touch. It passed 56 / 56 on one re-run. This flake has now appeared in two PRs and is worth its own fix. |

**Desktop Chromium (1440 px, no file sharing)**, for every type:
- the right recipient, number, file name and message;
- the "cannot attach automatically" instruction;
- the PDF downloads under exactly the name the sheet shows, and the content is checked to be the right document;
- that person's WhatsApp chat opens.

Also checked on desktop:
- list row buttons for quotation, invoice and delivery note;
- the editor toolbar Share;
- the invoice page receipt;
- the Business buttons kept and labelled;
- only PDF employee files offered;
- shares logged.

**Android phone emulation (390 px, Android Chrome user agent):**
- covered: payslip, salary receipt, quotation, invoice and delivery note (from the phone action bar), plus salary statement, customer receipt, customer statement and employee PDF;
- the actual PDF file goes to the share menu (file only, `application/pdf`), and its bytes are checked to be the right document for the right person;
- the message is copied.

**Also covered:**
- a phone browser without file sharing gets the manual flow;
- a reply that is not a PDF is refused;
- signed out, payslips and receipts are not served;
- balances are unchanged.

**Platforms:**
- **Tested:** headless Chromium on Linux only, in desktop mode and Android phone emulation, with the share menu simulated. Headless Chromium has none, and the test records exactly what the page hands over.
- **Not tested:** a real Android phone, iPhone or WhatsApp itself.
- **Already confirmed by you:** payslip sharing works on your phone.
- **Please check once:** one of the new documents, e.g. a customer receipt or statement, on the phone.
