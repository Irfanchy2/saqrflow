# WhatsApp Business (Cloud API)

Averiqo sends documents and messages to customers, suppliers and employees through the official
WhatsApp Business **Cloud API** (Meta). Sending uses the existing notification queue, which provides
retries, delivery receipts and the delivery log under **Reminders → Log**.

## What can be sent

| Message | Where the button is | PDF attached | Goes to |
|---|---|---|---|
| Quotation, Tax invoice, Delivery note | document editor (**WhatsApp**) | yes | customer |
| Quotation follow-up | editor of a sent/viewed quotation (**Follow-up**) | yes | customer |
| Payment reminder | editor of an unpaid invoice (**Reminder**) | yes | customer |
| Payment receipt | Invoices → Payments (row icon) | yes | customer / supplier |
| Customer statement | customer profile (**Send statement**), ledger page | yes | customer / supplier |
| Salary receipt / payslip | Employee → Salary (row icon) | yes (amounts only in the PDF) | employee |
| Document expiry reminder | Employee → Documents (**Remind**) | no | employee |
| Cheque reminder | Cheques (**Remind**) | no | customer / supplier |
| Project update | project page (**Send update**) | no | project's customer |

Every send opens a dialog with:

- the number, filled in from the record (`WhatsApp` field, otherwise `Phone`), which you can change for that one message;
- the exact text that will be sent;
- a note when a PDF is attached.

Nothing is sent until you press **Send**.

**History:** customer and supplier profiles and the employee **History** tab show each message with its status:

- Sent
- Delivered
- Read
- Failed (with the reason)
- Sandbox (not sent)

## Privacy rules (enforced in code)

- Emirates ID, passport and IBAN/account numbers, and any long digit run, are masked before sending. This applies to template values and to custom messages.
- Payslip messages never contain amounts. Amounts are only in the attached PDF.
- Expiry reminders name the document type only, never its number.
- Cheque reminders show only the last 4 digits.
- Access tokens stay on the server. The token is stored encrypted, never sent to the browser and never logged.
- WhatsApp history is visible only to roles that can see that kind of record:
  - customer and supplier messages need *finance.view*;
  - payslips need *salary.view*;
  - other employee messages need *employees.view_sensitive*.

  A database policy enforces this (migration `0020`).
- When someone replies **STOP**, their number is opted out and further sends are blocked. A reply of **START** opts them back in.

## Setup

1. **Meta side** ([developers.facebook.com](https://developers.facebook.com) → your app → WhatsApp):
   1. Add the business phone number and note its **Phone number ID**, your **WhatsApp Business Account ID** and the **App ID**.
   2. Create a **System User** in Business Settings and give it the *whatsapp_business_messaging* and *whatsapp_business_management* permissions.
   3. Generate a permanent token for that System User.
2. **Server environment** (Vercel → Project → Settings → Environment Variables; never commit these):
   - `WHATSAPP_VERIFY_TOKEN`: any long random string.
   - `META_APP_SECRET`: from App settings → Basic. Webhook signatures are verified with it.
   - `SETTINGS_ENCRYPTION_KEY`: already used for other secrets; the token is encrypted with it.
3. **Webhook** (Meta app → WhatsApp → Configuration):
   - Callback URL: `https://<your-domain>/api/webhooks/whatsapp`
   - Verify token: the value of `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **messages** field. This delivers status receipts as well as inbound messages, STOP replies and the 24-hour window.
4. **Averiqo → Settings → WhatsApp**:
   1. Enter the Phone number ID, Business Account ID, App ID and access token.
   2. Turn sandbox off and save.
   3. Press **Test connection**. It should show your business name and number.
5. **Settings → WhatsApp message templates**:
   1. Edit the text of each message if you want to.
   2. Press **Submit to WhatsApp for approval**.
   3. Use **Check status** until the template shows *Approved*. This usually takes minutes to a few hours.

   Templates are created as `averiqo_<type>`, in the *Utility* category, with a document header where a PDF is attached.

## Sandbox mode and the 24-hour window

**Sandbox mode** applies until WhatsApp is connected, or while sandbox is switched on. In sandbox mode every send is recorded with the status *Sandbox (not sent)* and nothing leaves Averiqo.

**Business-initiated messages** must use an approved template; this is a WhatsApp rule. When the contact has messaged you in the last 24 hours, the dialog also lets you send a custom message instead of the template.

## Tests

- `tests/unit/whatsapp-send.test.ts`: template variables, masking and payloads.
- `tests/db/rls.test.ts` (0020 block): history visibility and contacts.
- `tests/e2e/whatsapp.mjs` covers the full flow against a local Graph API stand-in:
  - connect and Test connection;
  - template submission and approval;
  - every message type, with PDF media and template parameters;
  - delivery receipts, failures, the 24-hour window and STOP;
  - the dialog at 360px.
