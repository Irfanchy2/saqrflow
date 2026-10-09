# Sales documents, payments & projects

## Quotation → Tax invoice → Delivery note
* **Sales & Invoices → New quotation / tax invoice / delivery note** creates a numbered draft (`QTN-2026-0001`, `INV-…`, `DN-…`; per company, per type, per year, gap-free — `next_document_number()`).
* The builder shows a **live A4 preview** that matches the printed/PDF page (your letterhead, footer, stamp and signature from *Settings → Branding & sales documents*). `Ctrl/⌘+S` saves; leaving with unsaved changes asks first. On phones, switch between *Edit* and *Preview*.
* Totals are always recomputed on the server. Quotations note VAT; tax invoices add VAT per line.
* **⋯ menu**: save PDF to the Document Vault (`Customers/<name>/<Quotations|Invoices|Delivery Notes>`, versioned, linked to the customer/project), email, convert (quotation → invoice / delivery note, invoice → delivery note), duplicate, change status, delete draft.
* **Print** opens a bare A4 page — the browser keeps Arabic shaping. The downloadable PDF (pdf-lib, Helvetica) prints Arabic only inside images (letterhead/stamp); typed Arabic shows as `?` — use Print → Save as PDF for Arabic text.

## Payments
* Record payments on an **issued** invoice (cash, transfer, cheque/PDC — optionally linked to a tracked cheque).
* The database rejects payments on drafts/quotations, cross-company payments and anything above the open balance.
* Status follows the money automatically: *Sent → Partially paid → Paid*; the daily scheduler marks unpaid invoices past their due date *Overdue*, and the reminder engine alerts on the outstanding balance (7/3/1/0 days).
* Invoices with payments are locked (issue a credit note instead of editing).
* *Receivables ageing* groups open balances per customer: current / 1–30 / 31–60 / 61–90 / 90+ days late.

## Projects
* Contract value, client, site, dates, status, **fabrication %** and **site %**.
* Milestones feed Smart Reminders; costs by category (materials, labour, transport, subcontract, equipment, other).
* KPIs: invoiced, received, outstanding, costs, estimated profit and margin.
* Project files (drawings, LPOs, photos, variation orders) are private, versioned documents linked to the project and client.
* Costs and money figures need the *finance.view* permission (accountant/owner); project managers see progress, milestones and files.

## OCR improvements (Smart Inbox)
* Photos/scans (PNG/JPG/WebP) are read **on your server** with Tesseract — no data leaves it, no API key needed.
* When AI reading is on, the Claude result is merged with the local reading: agreement raises confidence, disagreement caps it at 60% with a warning for a person to decide.
* Validators: Emirates ID check digit (Luhn), TRN format, passport format, date sanity (expiry after issue, plausible birth date, ≤10-year validity). Failed checks never block — they lower confidence and explain why.
* Scanned **PDFs** without a text layer still need AI reading (or manual entry).

## Setup checklist
1. Apply `supabase/migrations/0008_sales_projects.sql`.
2. Settings → Branding: upload letterhead (and optional invoice letterhead), footer, stamp, signature; set TRN, bank details, VAT %, default terms.
3. Optional: `ANTHROPIC_API_KEY` for AI reading of scanned PDFs.

## Template builder (Settings → Template builder)

Each of quotation, tax invoice and delivery note has its own template, stored in `app_settings` as `template.<type>`.
- **What you can change:**
  - the title;
  - the heading above the items;
  - which optional details print (attention, customer TRN, phone, email, site, project, LPO, DEL NO, reference, due date, valid till);
  - the column names;
  - the seal / signature block, bank details, amount in words and the "computer-generated" line;
  - a footer note.
- **One definition, two renderers:** `lib/sales/template.ts` is shared by the A4 paper (`components/sales/paper.tsx`: editor preview and print view) and the PDF (`lib/sales/pdf.ts`), so they always match.
- **Defaults:** they reproduce the standard Al Saqr layout exactly. "Standard layout" stores `false`.
- **Not switchable on a tax invoice** (UAE requirements): the company TRN, the VAT columns and the totals.
- **Credit notes:** they keep their own title.
- **Layout only:** saving never changes document content.

## Offline drafts and the installed app

- **Service worker** (`public/sw.js`):
  - caches only content-hashed build files and the `/offline` page;
  - pages and data always come from the network;
  - without a connection, `/offline` is shown instead of a browser error.
- **Drafts on the device** (`lib/drafts.ts`, keys `avq-draft:*`, kept 14 days):
  - **Sales editor:** unsaved edits are kept while offline. Reopening offers *Restore* or *Discard*; once restored they autosave when the connection returns.
  - **Forms with `draftKey`:** new ticket, ticket note, KB article, lead, lead activity, task, site visit, daily site report, expense and customer/supplier keep what was typed, and it is restored next time the form opens.
  - **Clearing:** a draft is removed once its form is saved. Every draft is removed on sign-out (shared devices).

## Averiqo AI business questions (`lib/ai/business.ts`)

- **Built-in rules (no AI key needed):**
  - money owed and overdue invoices, with balances after payments and credits;
  - project status and late projects;
  - everything expiring, including vehicle and equipment dates;
  - cheques due;
  - open service tickets;
  - the sales pipeline.
- **With Gemini configured:** only the question is sent, to understand it.
- **Permissions:** every query runs with the user's own session.
