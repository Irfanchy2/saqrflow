import 'server-only'
import { logLinkEvent, notifyCompany, type ResolvedLink } from '@/lib/portal'

const OPEN = ['sent', 'viewed', 'follow_up']

/** Quotations a link may act on: the link's own quotation, or (customer portal) any open quotation of that customer. */
export async function quoteForLink(r: ResolvedLink, quoteId: string) {
  const { data: q } = await r.admin.from('invoices').select('id,company_id,doc_type,number,status,customer_id,customer_name,total,valid_until,lead_id,created_by,salesperson_id,deleted_at')
    .eq('id', quoteId).eq('company_id', r.company.id).eq('doc_type', 'quotation').maybeSingle()
  if (!q || q.deleted_at) return null
  if (r.link.kind === 'quote_response' && r.link.invoice_id !== q.id) return null
  if (r.link.kind === 'customer_portal' && r.link.customer_id !== q.customer_id) return null
  if (r.link.kind !== 'quote_response' && r.link.kind !== 'customer_portal') return null
  return q
}

/** The customer opened the quotation online: Sent → Viewed (once). */
export async function markQuoteViewed(r: ResolvedLink, quoteId: string) {
  const q = await quoteForLink(r, quoteId)
  if (!q || q.status !== 'sent') return
  const { data } = await r.admin.from('invoices').update({ status: 'viewed', updated_at: new Date().toISOString() }).eq('id', q.id).eq('company_id', r.company.id).eq('status', 'sent').select('id')
  if (data?.length) await r.admin.from('sales_doc_events').insert({ company_id: r.company.id, invoice_id: q.id, event: 'status', detail: 'sent → viewed · opened by the customer online', user_id: null })
}

/**
 * Accept / reject by the customer. Same effects as the office doing it: status, follow-ups closed, lead moved to Won on
 * acceptance, history entry, notifications to finance users. Only open quotations within their validity can be answered.
 */
export async function respondToQuote(r: ResolvedLink, quoteId: string, decision: 'accepted' | 'rejected', name: string, note: string | null): Promise<{ ok: true; message: string } | { error: string }> {
  const q = await quoteForLink(r, quoteId)
  if (!q) return { error: 'This quotation is not available through this link.' }
  if (!OPEN.includes(q.status)) return { error: q.status === 'accepted' ? 'This quotation was already accepted. Thank you.' : `This quotation can no longer be answered online (status: ${q.status.replace('_', ' ')}). Please contact us.` }
  if (q.valid_until && q.valid_until < r.ctx.today) return { error: `This quotation expired on ${q.valid_until}. Please contact us for an updated offer.` }
  const now = new Date().toISOString()
  const { data: upd, error } = await r.admin.from('invoices').update({ status: decision, updated_at: now }).eq('id', q.id).eq('company_id', r.company.id).in('status', OPEN).select('id')
  if (error) return { error: 'Your answer could not be saved. Please try again.' }
  if (!upd?.length) return { error: 'This quotation was just updated. Reload the page.' }
  const who = `${name}${note ? ` · “${note}”` : ''}`.slice(0, 400)
  await Promise.all([
    r.admin.from('sales_followups').update({ done_at: now, outcome: `Quotation ${decision} online by the customer` }).eq('invoice_id', q.id).eq('company_id', r.company.id).is('done_at', null),
    r.admin.from('sales_doc_events').insert({ company_id: r.company.id, invoice_id: q.id, event: 'status', detail: `${q.status} → ${decision} · online by ${who}`.slice(0, 500), user_id: null }),
    q.lead_id && decision === 'accepted' ? r.admin.from('leads').update({ stage: 'won', won_at: now }).eq('id', q.lead_id).eq('company_id', r.company.id).neq('stage', 'won') : null,
    q.lead_id ? r.admin.from('lead_activities').insert({ company_id: r.company.id, lead_id: q.lead_id, kind: 'quotation', body: `Quotation ${q.number} ${decision} online by ${name}`.slice(0, 2000), user_id: null }) : null,
  ])
  await logLinkEvent(r, decision, `${q.number} · ${who}`)
  await notifyCompany(r, 'finance.view', { title: `Quotation ${q.number} ${decision} by the customer`, body: `${q.customer_name ?? ''} · ${who}`.slice(0, 500), link: `/invoices/${q.id}`, key: `quote_online:${q.id}:${decision}`, severity: decision === 'accepted' ? 'info' : 'warning' })
  return { ok: true, message: decision === 'accepted' ? `Thank you. Quotation ${q.number} is accepted; our team will contact you to schedule the work.` : `Thank you for letting us know. Quotation ${q.number} is marked as not accepted.` }
}
