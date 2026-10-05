import 'server-only'
import { z } from 'zod'
import type { Ctx } from '../auth'
import { DOC_TYPES, typeDef } from '../inbox/catalog'
import { nameScore } from '../inbox/match'
import { addDays, endOfMonth, formatLongDate } from '../time'
import { aiProviders } from './llm'

// Natural-language search. The question (only the question — no company data) may be turned into a structured
// query by Gemini; the query itself always runs with the signed-in user's Supabase session, so RLS decides what they see.

export const Intent = z.object({
  entity: z.enum(['documents', 'invoices', 'quotations', 'employees']),
  doc_type: z.string().nullable(),
  person: z.string().max(120).nullable(),
  customer: z.string().max(120).nullable(),
  expiring_within_days: z.number().int().min(0).max(3650).nullable(),
  expired: z.boolean(),
  latest: z.boolean(),
})
export type SearchIntent = z.infer<typeof Intent>
export interface SearchResult { title: string; sub: string; href: string; badge?: string; tone?: 'red' | 'amber' | 'green' | 'blue' | 'neutral' }
export interface SearchAnswer { summary: string; engine: 'gemini' | 'rules'; intent: SearchIntent; results: SearchResult[] }

const SYNONYMS: [RegExp, string][] = [
  [/\bvisas?\b|residen(ce|cy)/i, 'residence_visa'], [/emirates\s*id|\beid\b/i, 'emirates_id'], [/passports?/i, 'passport'], [/trade\s*licen[cs]e/i, 'trade_license'],
  [/tenancy|lease/i, 'tenancy_contract'], [/ejari/i, 'ejari'], [/mulkiya|vehicle\s*registration/i, 'vehicle_registration'], [/work\s*permit|labou?r\s*card/i, 'work_permit'],
  [/medical\s*insurance|health\s*insurance/i, 'medical_insurance'], [/establishment\s*card/i, 'establishment_card'], [/vat\s*(certificate|registration)/i, 'vat_certificate'],
  [/insurance/i, 'company_insurance'], [/labou?r\s*contract/i, 'labour_contract'], [/delivery\s*notes?/i, 'delivery_note'], [/purchase\s*orders?|\bLPOs?\b/i, 'purchase_order'],
]

/** Deterministic parser — works without any AI service and is the fallback when the AI is unavailable. */
export function parseQuery(q: string, today: string): SearchIntent {
  const s = q.trim()
  const intent: SearchIntent = { entity: 'documents', doc_type: null, person: null, customer: null, expiring_within_days: null, expired: false, latest: false }
  if (/\binvoices?\b/i.test(s) && !/supplier/i.test(s)) intent.entity = 'invoices'
  else if (/\bquotations?\b|\bquotes?\b/i.test(s)) intent.entity = 'quotations'
  for (const [re, key] of SYNONYMS) if (re.test(s)) { intent.doc_type = key; break }
  if (!intent.doc_type) for (const d of DOC_TYPES) if (new RegExp(`\\b${d.label.replace(/[()]/g, '').split(' ')[0]}`, 'i').test(s) && d.label.length > 5) { intent.doc_type = d.key; break }
  const within = /(?:within|in|next)\s+(\d{1,4})\s*(day|week|month)s?/i.exec(s)
  if (within) intent.expiring_within_days = Number(within[1]) * (within[2].toLowerCase() === 'week' ? 7 : within[2].toLowerCase() === 'month' ? 30 : 1)
  else if (/next\s+month/i.test(s)) intent.expiring_within_days = Math.round((Date.parse(endOfMonth(addDays(endOfMonth(today), 1))) - Date.parse(today)) / 864e5)
  else if (/this\s+month/i.test(s)) intent.expiring_within_days = Math.round((Date.parse(endOfMonth(today)) - Date.parse(today)) / 864e5)
  else if (/this\s+week/i.test(s)) intent.expiring_within_days = 7
  else if (/expir/i.test(s) && !/expired/i.test(s)) intent.expiring_within_days = 30
  if (/\bexpired\b|already\s+expired|overdue/i.test(s)) intent.expired = true
  if (/\blatest|newest|most\s+recent|current\b/i.test(s)) intent.latest = true
  const poss = /(?:find|show|get|open)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})(?:'s|’s)\s/.exec(s)
  if (poss) intent.person = poss[1].replace(/^(Find|Show|Get|Open)\s+/, '')
  const forWho = /\b(?:for|of|from)\s+([A-Z][\w&.\- ]{2,60}?)(?:\s*[?.!]|$)/.exec(s)
  if (forWho && !/next|this|our/i.test(forWho[1])) { if (intent.entity === 'invoices' || intent.entity === 'quotations') intent.customer = forWho[1].trim(); else intent.person ??= forWho[1].trim() }
  if (/which\s+employees/i.test(s) && !intent.doc_type) intent.entity = 'employees'
  return intent
}

const AI_SCHEMA = {
  type: 'OBJECT', required: ['entity', 'doc_type', 'person', 'customer', 'expiring_within_days', 'expired', 'latest'],
  properties: {
    entity: { type: 'STRING', enum: ['documents', 'invoices', 'quotations', 'employees'] },
    doc_type: { type: 'STRING', nullable: true, enum: DOC_TYPES.map(d => d.key) },
    person: { type: 'STRING', nullable: true }, customer: { type: 'STRING', nullable: true },
    expiring_within_days: { type: 'INTEGER', nullable: true }, expired: { type: 'BOOLEAN' }, latest: { type: 'BOOLEAN' },
  },
}

export async function aiSearch(c: Ctx, q: string): Promise<SearchAnswer> {
  let intent = parseQuery(q, c.today), engine: SearchAnswer['engine'] = 'rules'
  const { data: st } = await c.supabase.from('app_settings').select('value').eq('key', 'ai.provider').maybeSingle()
  const gemini = st?.value === 'rules' ? null : (await aiProviders(c.company.id)).gemini
  if (gemini?.configured()) {
    const t0 = Date.now()
    try {
      intent = await gemini.generateStructuredOutput(
        `Turn a business user's search question into a JSON query. Today is ${c.today}. "next month" means until the end of next month. Never invent names that are not in the question.`,
        q, AI_SCHEMA, raw => { const r = Intent.parse(raw); return { ...r, doc_type: r.doc_type && typeDef(r.doc_type) ? r.doc_type : null } })
      engine = 'gemini'
      await c.supabase.from('ai_processing_logs').insert({ company_id: c.company.id, created_by: c.userId, provider: 'gemini', model: gemini.model, purpose: 'search', ok: true, input_chars: q.length, processing_ms: Date.now() - t0 })
    } catch (e) {
      await c.supabase.from('ai_processing_logs').insert({ company_id: c.company.id, created_by: c.userId, provider: 'gemini', model: gemini.model, purpose: 'search', ok: false, input_chars: q.length, processing_ms: Date.now() - t0, error: (e as Error).message.slice(0, 300) })
    }
  }
  return { ...(await execute(c, intent)), engine, intent }
}

async function execute(c: Ctx, it: SearchIntent): Promise<{ summary: string; results: SearchResult[] }> {
  const results: SearchResult[] = []
  if (it.entity === 'invoices' || it.entity === 'quotations') {
    if (!c.can('finance.view')) return { summary: 'You do not have access to invoices.', results }
    let q = c.supabase.from('invoices').select('id,number,status,customer_name,issue_date,due_date,total').eq('doc_type', it.entity === 'invoices' ? 'invoice' : 'quotation').order('issue_date', { ascending: false }).limit(it.latest ? 1 : 25)
    if (it.customer) q = q.ilike('customer_name', `%${it.customer.replace(/[%_,()]/g, ' ').trim()}%`)
    if (it.expired) q = q.eq('status', 'overdue')
    const { data } = await q
    for (const r of data ?? []) results.push({ title: `${r.number} — ${r.customer_name ?? 'No customer'}`, sub: `${r.issue_date}${r.due_date ? ` · due ${r.due_date}` : ''} · AED ${Number(r.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, href: `/invoices/${r.id}`, badge: r.status.replace('_', ' '), tone: r.status === 'overdue' ? 'red' : r.status === 'paid' ? 'green' : 'blue' })
    return { summary: `${results.length} ${it.entity}${it.customer ? ` for “${it.customer}”` : ''}`, results }
  }

  // documents (RLS hides employee identity documents from roles without access)
  let ownerIds: string[] | null = null, personName: string | null = null
  if (it.person) {
    const { data: emps } = await c.supabase.from('employees').select('id,full_name').limit(2000)
    const hits = (emps ?? []).map(e => ({ ...e, s: nameScore(it.person!, e.full_name) })).filter(e => e.s >= 0.75).sort((a, b) => b.s - a.s)
    if (!hits.length) return { summary: `No employee matching “${it.person}” (or you cannot see their records).`, results }
    ownerIds = hits.slice(0, 3).map(h => h.id); personName = hits[0].full_name
  }
  let q = c.supabase.from('documents').select('id,name,expiry_date,issue_date,owner_type,owner_id,created_at,status,category:document_categories(name)').is('deleted_at', null).neq('status', 'archived')
  if (ownerIds) q = q.eq('owner_type', 'employee').in('owner_id', ownerIds)
  if (it.entity === 'employees') q = q.eq('owner_type', 'employee')
  const def = typeDef(it.doc_type)
  if (def) {
    const { data: cats } = await c.supabase.from('document_categories').select('id').eq('name', def.category)
    const ids = (cats ?? []).map(k => k.id)
    q = ids.length ? q.or(`category_id.in.(${ids.join(',')}),name.ilike.%${def.label.split(' ')[0]}%`) : q.ilike('name', `%${def.label.split(' ')[0]}%`)
  }
  if (it.expired) q = q.lt('expiry_date', c.today)
  else if (it.expiring_within_days != null) q = q.gte('expiry_date', c.today).lte('expiry_date', addDays(c.today, it.expiring_within_days))
  q = it.latest ? q.order(def?.hasExpiry ? 'expiry_date' : 'created_at', { ascending: false, nullsFirst: false }).limit(1) : q.order('expiry_date', { ascending: true, nullsFirst: false }).limit(50)
  const { data: docs } = await q
  const empIds = [...new Set((docs ?? []).filter(d => d.owner_type === 'employee' && d.owner_id).map(d => d.owner_id!))]
  const { data: owners } = empIds.length ? await c.supabase.from('employees').select('id,full_name').in('id', empIds) : { data: [] as { id: string; full_name: string }[] }
  for (const d of docs ?? []) {
    const days = d.expiry_date ? Math.round((Date.parse(d.expiry_date) - Date.parse(c.today)) / 864e5) : null
    const who = d.owner_type === 'employee' ? owners?.find(o => o.id === d.owner_id)?.full_name : null
    results.push({
      title: d.name, sub: [who, (d as any).category?.name, d.expiry_date ? `expires ${formatLongDate(d.expiry_date)}` : 'no expiry'].filter(Boolean).join(' · '),
      href: `/documents/${d.id}`, badge: days == null ? undefined : days < 0 ? `expired ${-days}d ago` : `${days} days left`, tone: days == null ? 'neutral' : days < 0 ? 'red' : days <= 30 ? 'amber' : 'green',
    })
  }
  const what = def ? def.label : 'document'
  const when = it.expired ? ' already expired' : it.expiring_within_days != null ? ` expiring within ${it.expiring_within_days} days` : ''
  const summary = it.entity === 'employees' && results.length
    ? `${new Set(results.map(r => r.sub.split(' · ')[0])).size} employee(s) with ${what.toLowerCase()}s${when}`
    : `${results.length} ${what.toLowerCase()}${results.length === 1 ? '' : 's'}${personName ? ` for ${personName}` : ''}${when}${it.latest ? ' (latest)' : ''}`
  return { summary, results }
}
