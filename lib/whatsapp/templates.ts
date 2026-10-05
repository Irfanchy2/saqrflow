import { formatAed, formatLongDate } from '../time'

/**
 * Only whitelisted, non-sensitive fields ever reach a message. No passport/Emirates ID/visa numbers,
 * no document files, no credentials. Templates must be created & approved in Meta Business Manager with
 * exactly this body text and variable order (see docs/WHATSAPP_SETUP.md).
 */
export type TemplateName = 'document_reminder' | 'payment_alert' | 'daily_summary' | 'test_message'

export const TEMPLATE_META: Record<TemplateName, { metaName: string; language: string; vars: string[] }> = {
  document_reminder: { metaName: 'saqrflow_document_reminder', language: 'en', vars: ['document', 'subject', 'expiryDate', 'daysRemaining', 'status'] },
  payment_alert: { metaName: 'saqrflow_payment_alert', language: 'en', vars: ['type', 'party', 'amount', 'date', 'action'] },
  daily_summary: { metaName: 'saqrflow_daily_summary', language: 'en', vars: ['expiring', 'cheques', 'invoices', 'renewals'] },
  test_message: { metaName: 'saqrflow_test_message', language: 'en', vars: ['note'] },
}

export type Params = Record<string, string>

const BODY: Record<TemplateName, string> = {
  document_reminder: 'SAQRFLOW REMINDER\nDocument: {{1}}\nSubject: {{2}}\nExpiry Date: {{3}}\nDays Remaining: {{4}}\nStatus: {{5}}\nPlease log in to SaqrFlow to review this document.',
  payment_alert: 'SAQRFLOW PAYMENT ALERT\nType: {{1}}\nParty: {{2}}\nAmount: {{3}}\nDate: {{4}}\nAction Required: {{5}}',
  daily_summary: 'Good Morning.\nSaqrFlow Daily Summary\nDocuments expiring within 30 days: {{1}}\nCheques due this week: {{2}}\nInvoices awaiting payment: {{3}}\nPending renewal tasks: {{4}}\nOpen SaqrFlow to review.',
  test_message: 'SAQRFLOW TEST\n{{1}}',
}
export const templateBody = (t: TemplateName) => BODY[t]

/** Meta rejects params containing newlines/tabs/4+ spaces; long digit runs (IDs, account numbers) are masked as a safety net. */
export function sanitizeParam(v: unknown, max = 120): string {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max)
  return s.replace(/\d{8,}/g, m => '•'.repeat(m.length - 4) + m.slice(-4)) || '-'
}

export function renderText(t: TemplateName, params: Params): string {
  const vars = TEMPLATE_META[t].vars
  return BODY[t].replace(/\{\{(\d+)\}\}/g, (_, i) => params[vars[Number(i) - 1]] ?? '-')
}

export function cloudApiPayload(t: TemplateName, params: Params, to: string) {
  const m = TEMPLATE_META[t]
  return {
    messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'template',
    template: {
      name: m.metaName, language: { code: m.language },
      components: [{ type: 'body', parameters: m.vars.map(v => ({ type: 'text', text: sanitizeParam(params[v]) })) }],
    },
  }
}

// ── param builders (the only way messages are composed) ──
export function documentParams(a: { title: string; subject?: string | null; expiry: string; daysRemaining: number }): Params {
  const d = a.daysRemaining
  return {
    document: sanitizeParam(a.title), subject: sanitizeParam(a.subject || 'Company'),
    expiryDate: formatLongDate(a.expiry), daysRemaining: String(d),
    status: d < 0 ? `Expired ${-d} day(s) ago – renewal overdue` : d === 0 ? 'Expires today' : 'Renewal Required',
  }
}
export function paymentParams(a: { direction: string | null; kind: string; party?: string | null; amount?: number | null; date: string; daysRemaining: number }): Params {
  const out = a.direction === 'outgoing'
  return {
    type: sanitizeParam(a.direction ? `${out ? 'Outgoing' : 'Incoming'} ${a.kind}` : a.kind),
    party: sanitizeParam(a.party || '-'), amount: a.amount != null ? formatAed(a.amount) : '-',
    date: formatLongDate(a.date),
    action: a.daysRemaining < 0 ? 'Overdue – follow up now' : out ? 'Verify available funds and payment status' : 'Prepare cheque for deposit and confirm status',
  }
}
export const digestParams = (n: { expiring: number; cheques: number; invoices: number; renewals: number }): Params =>
  ({ expiring: String(n.expiring), cheques: String(n.cheques), invoices: String(n.invoices), renewals: String(n.renewals) })
