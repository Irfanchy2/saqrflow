# Averiqo API, webhooks, notification rules and scheduled reports

Everything here is managed in **Settings** by users with `settings.manage` (Super Admin, Company Owner).

## Read-only REST API

Create a key in **Settings → API & webhooks → Create API key**:
- Choose what it may read (scopes) and when it expires.
- The key (`avq_…`) is shown **once**. Only its SHA-256 fingerprint is stored.
- Revoking a key takes effect immediately.

```
GET /api/v1/{resource}          list, oldest first
GET /api/v1/{resource}/{id}     one record
Authorization: Bearer avq_…
```

| Resource | Scope | Fields |
|---|---|---|
| `customers` | customers.read | id, name, contact_person, phone, email, trn, address, credit_days, created_at |
| `invoices` | invoices.read | id, number, status, issue_date, due_date, customer_id, customer_name, project_id, subtotal, vat_amount, total, created_at |
| `quotations` | quotations.read | id, number, status, issue_date, valid_until, customer_id, customer_name, project_id, subject, subtotal, vat_amount, total, created_at |
| `payments` | payments.read | id, invoice_id, amount, paid_on, method, reference, created_at |
| `projects` | projects.read | id, code, name, status, customer_id, location, start_date, expected_completion, fabrication_progress, site_progress, created_at |
| `leads` | leads.read | id, number, company_name, contact_person, stage, source, service, estimated_value, expected_close, customer_id, created_at |
| `tickets` | tickets.read | id, number, title, status, priority, category, source, customer_id, project_id, due_date, under_warranty, created_at, resolved_at |

**Query parameters**
- `?limit=` sets the page size (1–100, default 50).
- `?created_after=2026-01-01` returns only records created on or after that date.
- `?cursor=` continues a list: pass the `next_cursor` value from the previous page. `next_cursor` is `null` on the last page.

**Response and errors**
- A successful call returns `{ "data": [...], "next_cursor": "…" | null }`.
- An error returns `{ "error": { "code": "…", "message": "…" } }` with status 401 (bad key), 403 (missing scope), 404 (not found) or 400 (bad query).
- Rate limit: 120 requests per minute per IP address.

**What the API cannot do**
- It cannot write: there are no create, update or delete calls.
- It never returns deleted records, salaries, employee documents or files.

## Webhooks

Add an endpoint in **Settings → API & webhooks → Add webhook**:
- **URL:** must be `https`, reachable from the internet. Private, loopback and cloud-metadata addresses are refused.
- **Events:** choose which events it receives, or "Everything".
- **Signing secret (`whsec_…`):** shown once. Use **New secret** to replace it; the old one stops working immediately.

Each delivery is a `POST` with a JSON body:

```json
{ "id": "evt_123", "type": "quotation.accepted", "created_at": "2026-10-09T08:15:00Z",
  "data": { "id": "<record id>", "number": "AS-002600/2026", "party": "Client LLC", "amount": 52500, "status": "accepted", "url": "https://…/invoices/<id>" } }
```

**Headers**
- `X-Averiqo-Event`: the event type.
- `X-Averiqo-Delivery`: a unique id per delivery. Use it to ignore repeats.
- `X-Averiqo-Signature: t=<unix seconds>,v1=<hex>`.

**Verifying the signature** (Node.js):

```js
const [t, v1] = header.split(',').map(p => p.split('=')[1])
const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)) && Math.abs(Date.now() / 1000 - Number(t)) < 300
```

**Delivery rules**
- Your endpoint must answer with a 2xx status within 8 seconds. Redirects are not followed.
- Failed deliveries are retried after 1 min, 5 min, 30 min, 2 h and 12 h.
- A 4xx answer is not retried, except 408 and 429.
- After 15 failed deliveries in a row, the endpoint is switched off. The reason is shown in Settings; switch it back on when it is fixed.
- **Send test** delivers a `ping` event at once and shows the HTTP result.
- The last 15 deliveries are listed in Settings.

**Events**
- **Sales:** `quotation.created`, `quotation.sent`, `quotation.accepted`, `quotation.rejected`, `invoice.created`, `invoice.sent`, `invoice.paid`, `invoice.overdue`, `delivery_note.created`, `delivery_note.delivered`, `credit_note.created`, `receipt.created`.
- **Purchasing:** `purchase_order.created`, `purchase_order.sent`.
- **Finance:** `payment.received`, `expense.created`, `cheque.returned`.
- **Approvals:** `approval.requested`.
- **CRM:** `customer.created`, `lead.created`, `lead.won`, `lead.lost`.
- **Service:** `ticket.created`, `ticket.resolved`.

Records created by the import wizard do not raise `customer.created` or `lead.created`, so a bulk import does not flood your endpoints or alerts.

## How events flow

1. **Recording:** database triggers write each event to `app_events` in the same transaction as the change (migration 0019).
2. **Immediate processing:** right after any save, the server runs `lib/event-worker.ts`. It:
   - turns each event into notification-rule messages (queued in `notification_logs`) and webhook deliveries;
   - sends what is due.
3. **Daily sweep:** the morning scheduler (`/api/cron/reminders`, Vercel Cron) picks up anything left over and retries failed webhooks.
4. **Optional faster retries:** call `/api/cron/events` with `Authorization: Bearer $CRON_SECRET` from any external cron, for example every 5 minutes.

## Notification rules

**Settings → Notification rules.** A rule has four parts:
- **Event:** what triggers it.
- **Minimum amount:** optional. For example, "quotation accepted" with a minimum of AED 50,000.
- **Channels:** in-app, email and/or WhatsApp.
- **Recipients:** chosen from the people under **Reminders → Recipients**.

**Delivery**
- Each recipient only gets the channels they can receive. WhatsApp needs their opt-in and the approved template `saqrflow_event_alert`.
- Every message appears in **Reminders → Delivery log**.

## Scheduled reports

**Settings → Scheduled reports.** Choose:
- **Frequency:** weekly (a weekday, covering the previous 7 days) or monthly (day 1–28, covering the previous month).
- **Sections:** sales, collections, expenses, receivables, leads, service.
- **Channels and recipients.**

**Sending**
- **Schedule:** reports go out with the morning scheduler run (about 08:00 Dubai). A missed day is sent the next morning.
- **Send now:** sends the latest period immediately.
- **WhatsApp:** carries the headline figures, using the approved template `saqrflow_scheduled_report`.
- **Email and in-app:** carry the full report.

## WhatsApp templates to approve in Meta

The two new templates are listed with their exact text in **Settings → WhatsApp**:
- `saqrflow_event_alert`, variables: rule, event.
- `saqrflow_scheduled_report`, variables: report, period, invoiced, collected, outstanding.
