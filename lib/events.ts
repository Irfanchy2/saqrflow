// Business events (written by DB triggers into app_events, migration 0019) and what can subscribe to them.
// Shared by the server worker (lib/event-worker.ts) and the settings UI.

export type EventDef = { label: string; group: string; money?: boolean; link: (id: string, d: EventData) => string; title: (d: EventData) => string }
export type EventData = { number?: string; title?: string; name?: string; party?: string; amount?: number | string; status?: string; date?: string; due_date?: string; priority?: string; type?: string; method?: string; source?: string; category?: string; direction?: string }

const aed = (v: unknown) => (v === undefined || v === null || v === '' ? '' : `AED ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const join = (...p: (string | undefined | false)[]) => p.filter(Boolean).join(' · ')
const sales = (path: string) => (id: string) => `/${path}/${id}`

export const EVENTS: Record<string, EventDef> = {
  'quotation.created': { label: 'Quotation created', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Quotation ${d.number ?? ''}`, d.party, aed(d.amount)) },
  'quotation.sent': { label: 'Quotation sent', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Quotation ${d.number ?? ''} sent`, d.party, aed(d.amount)) },
  'quotation.accepted': { label: 'Quotation accepted', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Quotation ${d.number ?? ''} accepted`, d.party, aed(d.amount)) },
  'quotation.rejected': { label: 'Quotation rejected', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Quotation ${d.number ?? ''} rejected`, d.party, aed(d.amount)) },
  'invoice.created': { label: 'Tax invoice created', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Invoice ${d.number ?? ''}`, d.party, aed(d.amount)) },
  'invoice.sent': { label: 'Tax invoice sent', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Invoice ${d.number ?? ''} sent`, d.party, aed(d.amount)) },
  'invoice.paid': { label: 'Tax invoice paid in full', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Invoice ${d.number ?? ''} paid`, d.party, aed(d.amount)) },
  'invoice.overdue': { label: 'Tax invoice overdue', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Invoice ${d.number ?? ''} is overdue`, d.party, aed(d.amount)) },
  'delivery_note.created': { label: 'Delivery note created', group: 'Sales', link: sales('invoices'), title: d => join(`Delivery note ${d.number ?? ''}`, d.party) },
  'delivery_note.delivered': { label: 'Delivery note delivered', group: 'Sales', link: sales('invoices'), title: d => join(`Delivery note ${d.number ?? ''} delivered`, d.party) },
  'purchase_order.created': { label: 'Purchase order created', group: 'Purchasing', money: true, link: sales('invoices'), title: d => join(`Purchase order ${d.number ?? ''}`, aed(d.amount)) },
  'purchase_order.sent': { label: 'Purchase order sent', group: 'Purchasing', money: true, link: sales('invoices'), title: d => join(`Purchase order ${d.number ?? ''} sent`, aed(d.amount)) },
  'credit_note.created': { label: 'Credit note created', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Credit note ${d.number ?? ''}`, d.party, aed(d.amount)) },
  'receipt.created': { label: 'Receipt created', group: 'Sales', money: true, link: sales('invoices'), title: d => join(`Receipt ${d.number ?? ''}`, d.party, aed(d.amount)) },
  'payment.received': { label: 'Payment received', group: 'Finance', money: true, link: (_, d) => '/invoices?tab=payments', title: d => join(`Payment received ${aed(d.amount)}`, d.number && `for ${d.number}`, d.party) },
  'expense.created': { label: 'Expense recorded', group: 'Finance', money: true, link: () => '/expenses', title: d => join(`Expense ${aed(d.amount)}`, d.title) },
  'cheque.returned': { label: 'Cheque returned (bounced)', group: 'Finance', money: true, link: (_, d) => `/cheques?status=returned${d.number ? `&q=${encodeURIComponent(d.number)}` : ''}`, title: d => join(`Cheque ${d.number ?? ''} returned`, d.party, aed(d.amount)) },
  'approval.requested': { label: 'Approval requested', group: 'Approvals', money: true, link: () => '/approvals', title: d => join(`Approval needed: ${d.title ?? ''}`, aed(d.amount)) },
  'customer.created': { label: 'New customer', group: 'CRM', link: id => `/parties/${id}`, title: d => `New customer: ${d.name ?? ''}` },
  'lead.created': { label: 'New lead', group: 'CRM', money: true, link: id => `/leads/${id}`, title: d => join(`New lead ${d.number ?? ''}`, d.party, d.source) },
  'lead.won': { label: 'Lead won', group: 'CRM', money: true, link: id => `/leads/${id}`, title: d => join(`Lead won ${d.number ?? ''}`, d.party, aed(d.amount)) },
  'lead.lost': { label: 'Lead lost', group: 'CRM', money: true, link: id => `/leads/${id}`, title: d => join(`Lead lost ${d.number ?? ''}`, d.party) },
  'ticket.created': { label: 'Service ticket opened', group: 'Service', link: id => `/tickets/${id}`, title: d => join(`Service ticket ${d.number ?? ''}`, d.title, d.priority !== 'normal' && d.priority) },
  'ticket.resolved': { label: 'Service ticket resolved', group: 'Service', link: id => `/tickets/${id}`, title: d => join(`Service ticket ${d.number ?? ''} resolved`, d.title) },
}
export const EVENT_KEYS = Object.keys(EVENTS)
export const isEvent = (e: string) => e in EVENTS
export const eventGroups = () => {
  const g = new Map<string, [string, EventDef][]>()
  for (const [k, d] of Object.entries(EVENTS)) g.set(d.group, [...(g.get(d.group) ?? []), [k, d]])
  return [...g.entries()]
}

/** Whether an event passes a rule's minimum amount (rules without a minimum, or events without an amount, always pass). */
export function amountPasses(min: number | string | null | undefined, data: EventData): boolean {
  if (min === null || min === undefined || min === '') return true
  if (data.amount === undefined || data.amount === null || data.amount === '') return false
  return Number(data.amount) >= Number(min)
}

/** The JSON body a webhook receives. Stable, documented shape (docs/API.md). */
export function webhookBody(e: { id: number | string; event: string; entity_id: string | null; created_at: string; data: EventData }, appUrl: string) {
  const def = EVENTS[e.event]
  return { id: `evt_${e.id}`, type: e.event, created_at: e.created_at, data: { id: e.entity_id, ...e.data, url: def && e.entity_id ? `${appUrl}${def.link(e.entity_id, e.data)}` : undefined } }
}
