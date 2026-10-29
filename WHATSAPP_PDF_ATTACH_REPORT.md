# WhatsApp sharing: getting the actual PDF into WhatsApp

Date: 29 Oct 2026 · Branch: `whatsapp-pdf-attach` · No database change, no migration.

## 1. Why the PDF was not attached

| # | Cause | Where |
| --- | --- | --- |
| 1 | **A chat link can only carry text.** "Open chat with message" and the computer button use `wa.me/<number>?text=…`. WhatsApp has no way to receive a file through that link, so the chat opened with the message and no PDF. On phones this button sat next to the share button and looked like the main way to share. | `share-sheet.tsx` `openChat` |
| 2 | **PDF and text were shared together.** `navigator.share({ files, text, title })`: with a file and text in one share, WhatsApp on iPhone and on some Android versions keeps the text and drops the file. | `share-sheet.tsx` `shareNative` |
| 3 | **The tap could expire before the share menu opened.** The code waited for the clipboard copy before calling `navigator.share`. Browsers allow the share menu only straight after a tap, so some phones refused it, and the sheet then replaced itself with an error. | `shareNative` |
| 4 | **The file was never checked.** The fetched PDF was wrapped as `application/pdf` without checking it. After a session ended, a sign-in page could have been shared as a ".pdf". If fetching failed, the share button disappeared without a word, leaving only the text-only chat link. | prefetch in `Sheet` |
| 5 | **Phones only, and only some.** File sharing was offered only when the screen reported a touch-only pointer (`pointer: coarse`). | `nativeFileShare` |
| 6 | **The phone WhatsApp button on quotations, invoices and delivery notes was the paid WhatsApp Business button.** While Business is not connected it runs in sandbox: nothing is sent and no PDF reaches WhatsApp. The free sheet was only in the "More" menu. | `components/sales/editor.tsx` (phone capsule) |
| 7 | **Wrong file name on computers.** For sales documents, the sheet said "attach Quotation_AS-…pdf", but the file downloads as `AS-…_Customer_Quotation.pdf`. | `app/actions/share.ts` |
| 8 | **The computer preview downloaded the document.** The sales PDF route only knew `?inline=1`, so the sheet's `?view=1` preview downloaded the file and logged a false "downloaded" event. | `app/api/sales/[id]/pdf/route.ts` |

## 2. What changed (the existing sheet, templates, PDFs and permissions are reused)

**Phones and tablets that can share files** (Android Chrome, the installed Averiqo app, iPhone Safari):
- The main button is **"Share PDF to WhatsApp"**.
- It hands the phone's share menu **the PDF file only**, as `application/pdf`, with the document's own file name.
- The admin chooses WhatsApp, then the person's chat, then Send.
- **The message is copied to the clipboard at the same tap.** The sheet says, before and after, to paste it as the caption.
- A "Copy message" button is always there. Where copying is blocked, the message is selected so it can be copied by hand.
- **"Open chat with message (text only)"** stays as a second option. It says it is text only and downloads nothing.
- The PDF is fetched when the sheet opens, so the share menu opens straight from the tap.
- **The file is checked before it is offered.** It must answer `200`, have type `application/pdf`, and begin with `%PDF-`.
  - Anything else, such as a sign-in page, is refused with a clear message.
  - "Try again" fetches it again, and Download PDF stays available.
- File sharing is detected with `navigator.canShare({ files: [file] })`, run on the real PDF, not on screen type.

**Computers and phone browsers that cannot share files:**
- Before anything is clicked, the sheet says: "This browser cannot attach the PDF to WhatsApp automatically."
- "Download PDF & open chat" saves the PDF under the name the sheet shows (now the real download name). It then opens that person's chat with the message, plus the steps: paperclip → Document → pick the file → Send.
- Afterwards: "WhatsApp opened … The PDF is not attached yet".
- Where a computer browser can share files (some Windows and Mac browsers), a secondary **"Share PDF…"** button also appears.

**Honest wording everywhere:**
- After a phone share: "The PDF was passed to the share menu. If you chose WhatsApp, the file is in the chat you picked…".
- It never says "sent" or "attached" when the device cannot do it.
- "Averiqo does not know whether the message was sent" is kept.

**Sales documents on phones:** the green WhatsApp button in the editor's phone action bar opens this free sheet when WhatsApp Business is not connected. When Business is connected it still uses Business, as before. The desktop WhatsApp Business button is unchanged.

**Not changed:**
- WhatsApp message templates, salary calculations and PDF layouts;
- the share log;
- recipient selection (the record's own employee or customer);
- permissions;
- the WhatsApp Business integration.

No paid service or WhatsApp Cloud API is used for free sharing.

## 3. Security

- **Same endpoints as before.** The PDF comes from the same signed-in endpoints:
  - payslip and salary receipt: salary access, or the employee for their own;
  - sales documents: finance access.
- **Fetched in the browser.** The file is fetched by the signed-in browser and handed straight to the share menu. No public link is created and nothing is stored.
- **Not counted as downloads.** The sheet's preview (`?view=1`) and its copy for the share menu (`?share=1`) are no longer logged as downloads. A real Download still is.

## 4. Tests actually run (nothing against production)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | passed |
| Unit tests | 296 / 296 passed |
| DB tests (all migrations on a fresh Postgres) | 165 / 165 passed |
| `tests/e2e/share.mjs` (production build, real Chromium) | 80 / 80 passed (was 40) |
| Full `scripts/e2e.sh` (production build plus 23 suites) | Every suite passed except one check: smoke 141, inbox 49, sales 43, ai-reader 54, print 65, erp 59, averiqo 84, operations 63, advanced 41, portals 50, service 29, platform 51, extras 34, WhatsApp Business 49, project-payments 48, payments-status 56, demo 38, stock-bank 30, expenses 64, portal 119, salary 45, share 80. The QA sweep failed one check: the known intermittent React #418 on HR manager's redirect away from `/invoices`, a page this change does not touch. It passed 56 / 56 on one re-run. |

**Desktop Chromium, 1440 px (no file sharing):** for each of payslip, salary receipt, quotation, tax invoice and delivery note:
- **Recipient:** the right name and number (Ali Hassan +971 50 111 2222; Gulf Horizon Interiors +971 50 999 8877).
- **Message:** each document's own message.
- **Up front:** the "cannot attach automatically" instruction.
- **The download:**
  - the PDF downloads under exactly the name the sheet shows;
  - the downloaded file is a real PDF;
  - that person's `wa.me` chat opens with the message.
- **Afterwards:** "The PDF is not attached yet".
- **Sales preview:** opens inline and is not counted as a download.

**Android phone emulation** (390 px, Android Chrome user agent, touch), for all five documents:
- The PDF file is handed to the share menu: one file, `application/pdf`, starting with `%PDF-`, 1 KB or larger.
- Only the file is shared, with no text.
- The message is on the clipboard and the sheet says to paste it.
- The shared bytes were opened as a PDF and checked to be the right document for the right person:
  - Ali's October payslip;
  - the AED 2,000.00 receipt with reference CASH-1;
  - AS-SH1/2026, INV-SH1/2026 and DN-SH1/2026 for Gulf Horizon Interiors, from the editor's phone WhatsApp button.
- "Open chat (text only)" downloads nothing.
- The sheet fits the screen.

**Phone browser without file sharing:** no share button, a plain manual-attach instruction, then download and chat.

**Server reply that is not a PDF (a sign-in page):** refused, nothing shared, explained; "Try again" then works.

**Balances:** identical before and after sharing.

### Platforms on which PDF attachment was actually tested

- **Tested:** headless Chromium on Linux only.
  - Desktop mode, and Android phone emulation.
  - The phone share menu is simulated in the test. Headless Chromium has none, and the test records exactly what the page hands to it.
- **Not tested here:** a physical Android phone, the installed Android app, iPhone Safari, or WhatsApp itself. None is available from this environment.
- **What that means:** the tests show the actual PDF is handed to the browser's share API correctly. Whether WhatsApp then shows it in the chat has to be confirmed once by hand.

## 5. Please check once on a real phone

1. On an Android phone, in Chrome or the installed Averiqo app, open a payslip → Share via WhatsApp → **Share PDF to WhatsApp**.
2. Choose WhatsApp, then the employee. The PDF should appear in the chat. Paste the message as the caption, then send.
3. Repeat once from an invoice, using the green WhatsApp button at the bottom right of the editor on the phone.
4. On a computer: **Download PDF & open chat**, then attach the downloaded file with the paperclip.
