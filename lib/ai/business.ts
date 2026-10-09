import 'server-only'
import type { Ctx } from '../auth'
import { addDays, formatAed, formatShortDate } from '../time'
import type { SearchIntent, SearchResult, SearchStat } from './search'

// Business questions for the assistant: money owed, overdue invoices, project status, everything expiring, cheques due,
// service tickets and the sales pipeline. Every query runs with the signed-in user's session (RLS + permission checks).

type Out = { summary: string; results: SearchResult[]; stats?: SearchStat[] }
const like = (s: string) => `%${s.replace(/[%_,()]/g, ' ').trim()}%`
const OPEN = ['sent', 'viewed', 'follow_up', 'partially_paid', 'overdue']
const daysTo = (d: string, today: string) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5)
const n = (v: unknown) => Number(v ?? 0)

export const BUSINESS = new Set(['receivables', 'projects', 'expiries', 'cheques', 'tickets', 'leads'])

export async function businessAnswer(c: Ctx, it: SearchIntent): Promise<Out> {
  switch (it.entity) {
    case 'receivables': return receivables(c, it)
    case 'projects': return projects(c, it)
    case 'expiries': return expiries(c, it)
    case 'cheques': return cheques(c, it)
    case 'tickets': return tickets(c, it)
    default: return leads(c, it)
  }
}

/** Unpaid balances by invoice, largest first; totals and overdue share. Also answers "overdue invoices". */
export async function receivables(c: Ctx, it: SearchIntent): Promise<Out> {
  if (!c.can('finance.view')) return { summary: 'You do not have access to invoices and payments.', results: [] }
  let q = c.supabase.from('invoices').select('id,number,customer_name,due_date,total,status').eq('doc_type', 'invoice').in('status', OPEN).limit(2000)
  if (it.customer) q = q.ilike('customer_name', like(it.customer))
  const { data: inv } = await q
  const ids = (inv ?? []).map(i => i.id), bal = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 200) { const { data } = await c.supabase.from('invoice_balances').select('id,balance').in('id', ids.slice(i, i + 200)); for (const b of data ?? []) bal.set(b.id, n(b.balance)) }
  let rows = (inv ?? []).map(i => ({ ...i, balance: bal.get(i.id) ?? n(i.total), late: !!i.due_date && i.due_date < c.today })).filter(r => r.balance > 0.004)
  if (it.expired) rows = rows.filter(r => r.late)
  rows.sort((a, b) => Number(b.late) - Number(a.late) || b.balance - a.balance)
  const total = rows.reduce((a, r) => a + r.balance, 0), overdue = rows.filter(r => r.late), overdueTotal = overdue.reduce((a, r) => a + r.balance, 0)
  const byCustomer = new Map<string, number>(); for (const r of rows) byCustomer.set(r.customer_name ?? 'No customer', (byCustomer.get(r.customer_name ?? 'No customer') ?? 0) + r.balance)
  const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    summary: rows.length ? `${formatAed(total)} ${it.expired ? 'overdue' : 'outstanding'} on ${rows.length} invoice${rows.length === 1 ? '' : 's'}${it.customer ? ` for “${it.customer}”` : ` from ${byCustomer.size} customer${byCustomer.size === 1 ? '' : 's'}`}` : `Nothing ${it.expired ? 'overdue' : 'outstanding'}${it.customer ? ` for “${it.customer}”` : ''}.`,
    stats: rows.length ? [{ label: 'Outstanding', value: formatAed(total), tone: 'blue' }, { label: 'Overdue', value: `${formatAed(overdueTotal)} (${overdue.length})`, tone: overdue.length ? 'red' : 'green' },
      ...(top && !it.customer ? [{ label: 'Largest balance', value: `${top[0]} · ${formatAed(top[1])}` } as SearchStat] : [])] : undefined,
    results: rows.slice(0, 25).map(r => ({ title: `${r.number}: ${r.customer_name ?? 'No customer'}`, sub: `Balance ${formatAed(r.balance)} of ${formatAed(n(r.total))}${r.due_date ? ` · due ${formatShortDate(r.due_date)}` : ''}`,
      href: `/invoices/${r.id}`, badge: r.late ? `${-daysTo(r.due_date!, c.today)} days overdue` : r.due_date ? `due in ${daysTo(r.due_date, c.today)} days` : 'no due date', tone: r.late ? 'red' : 'amber' })),
  }
}

export async function projects(c: Ctx, it: SearchIntent): Promise<Out> {
  let q = c.supabase.from('projects').select('id,code,name,status,fabrication_progress,site_progress,contract_value,expected_completion,customer:customers(name)').is('deleted_at', null).order('created_at', { ascending: false }).limit(it.customer ? 20 : 50)
  if (it.customer) q = q.or(`name.ilike.${like(it.customer)},code.ilike.${like(it.customer)}`)
  else q = q.not('status', 'in', '(completed,cancelled)')
  const { data } = await q
  let rows = (data ?? []) as any[]
  if (it.expired) rows = rows.filter(p => p.expected_completion && p.expected_completion < c.today && !['completed', 'cancelled'].includes(p.status))
  const late = rows.filter(p => p.expected_completion && p.expected_completion < c.today && !['completed', 'cancelled'].includes(p.status))
  const counts = new Map<string, number>(); for (const p of rows) counts.set(p.status, (counts.get(p.status) ?? 0) + 1)
  return {
    summary: rows.length ? `${rows.length} project${rows.length === 1 ? '' : 's'}${it.customer ? ` matching “${it.customer}”` : it.expired ? ' past their completion date' : ' in progress'}${late.length && !it.expired ? `, ${late.length} past the completion date` : ''}` : `No project${it.customer ? ` matching “${it.customer}”` : 's found'}.`,
    stats: rows.length ? [...counts.entries()].map(([k, v]) => ({ label: k.charAt(0).toUpperCase() + k.slice(1).replace('_', ' '), value: String(v), tone: k === 'active' ? 'blue' : k === 'on_hold' ? 'amber' : k === 'completed' ? 'green' : 'neutral' } as SearchStat)) : undefined,
    results: rows.map(p => { const isLate = late.includes(p)
      return { title: `${p.code ? `${p.code} · ` : ''}${p.name}`, sub: [p.customer?.name, `fabrication ${p.fabrication_progress}% · site ${p.site_progress}%`, p.contract_value ? formatAed(n(p.contract_value)) : null, p.expected_completion ? `complete by ${formatShortDate(p.expected_completion)}` : null].filter(Boolean).join(' · '),
        href: `/projects/${p.id}`, badge: isLate ? 'late' : p.status.replace('_', ' '), tone: isLate ? 'red' : p.status === 'active' ? 'blue' : p.status === 'completed' ? 'green' : p.status === 'on_hold' ? 'amber' : 'neutral' } }),
  }
}

/** Everything with a date: company and employee documents, vehicles (Mulkiya, insurance, inspection), equipment, warranties. */
export async function expiries(c: Ctx, it: SearchIntent): Promise<Out> {
  const within = it.expiring_within_days ?? 30
  let q = c.supabase.from('reminder_sources').select('source_type,source_id,title,subject,category,due_date,link').order('due_date').limit(200)
  q = it.expired ? q.lt('due_date', c.today).gte('due_date', addDays(c.today, -365)) : q.gte('due_date', c.today).lte('due_date', addDays(c.today, within))
  q = q.or('source_type.eq.document,source_type.like.asset_*')   // documents (RLS-scoped) and vehicle / equipment dates
  const { data } = await q
  const rows = (data ?? []) as any[]
  const vehicles = rows.filter(r => r.link?.startsWith('/assets/')).length
  return {
    summary: rows.length ? `${rows.length} item${rows.length === 1 ? '' : 's'} ${it.expired ? 'already expired (last 12 months)' : `expiring within ${within} days`}${vehicles ? `, ${vehicles} for vehicles and equipment` : ''}` : `Nothing ${it.expired ? 'expired' : `expiring within ${within} days`}.`,
    stats: rows.length ? [{ label: 'Documents', value: String(rows.length - vehicles) }, { label: 'Vehicles & equipment', value: String(vehicles) }, { label: 'Next', value: `${formatShortDate(rows[0].due_date)}`, tone: 'amber' }] : undefined,
    results: rows.slice(0, 50).map(r => { const d = daysTo(r.due_date, c.today)
      return { title: r.title, sub: [r.subject, r.category, `${d < 0 ? 'expired' : 'expires'} ${formatShortDate(r.due_date)}`].filter(Boolean).join(' · '), href: r.link ?? '/reminders', badge: d < 0 ? `expired ${-d}d ago` : d === 0 ? 'today' : `${d} days left`, tone: d < 0 ? 'red' : d <= 14 ? 'amber' : 'green' } }),
  }
}

export async function cheques(c: Ctx, it: SearchIntent): Promise<Out> {
  if (!c.can('finance.view')) return { summary: 'You do not have access to cheques.', results: [] }
  const within = it.expiring_within_days ?? 7
  let q = c.supabase.from('cheques').select('id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status').in('status', ['received', 'issued', 'scheduled', 'deposited', 'presented']).order('cheque_date').limit(100)
  q = it.expired ? q.lt('cheque_date', c.today) : q.lte('cheque_date', addDays(c.today, within))
  if (it.customer) q = q.ilike('party_name', like(it.customer))
  const { data } = await q
  const rows = data ?? [], inc = rows.filter(r => r.direction === 'incoming'), out = rows.filter(r => r.direction === 'outgoing')
  return {
    summary: rows.length ? `${rows.length} cheque${rows.length === 1 ? '' : 's'} ${it.expired ? 'past their date and still open' : `due within ${within} days (including any past-dated still open)`}` : `No open cheques ${it.expired ? 'past their date' : `due within ${within} days`}.`,
    stats: rows.length ? [{ label: 'To receive', value: `${formatAed(inc.reduce((a, r) => a + n(r.amount), 0))} (${inc.length})`, tone: 'green' }, { label: 'To pay', value: `${formatAed(out.reduce((a, r) => a + n(r.amount), 0))} (${out.length})`, tone: 'amber' }] : undefined,
    results: rows.map(r => { const d = daysTo(r.cheque_date, c.today)
      return { title: `Cheque ${r.cheque_no} · ${r.party_name ?? ''}`, sub: `${r.direction === 'incoming' ? 'Incoming' : 'Outgoing'} · ${formatAed(n(r.amount))} · ${r.bank_name ?? ''} · ${formatShortDate(r.cheque_date)}`, href: `/cheques?q=${encodeURIComponent(r.cheque_no)}`,
        badge: d < 0 ? `${-d}d past` : d === 0 ? 'today' : `in ${d} days`, tone: d < 0 ? 'red' : d <= 2 ? 'amber' : 'blue' } }),
  }
}

export async function tickets(c: Ctx, it: SearchIntent): Promise<Out> {
  let q = c.supabase.from('service_tickets').select('id,number,title,status,priority,due_date,under_warranty,customer:customers(name)').in('status', ['open', 'scheduled', 'in_progress', 'waiting_customer']).order('due_date', { nullsFirst: false }).limit(100)
  if (it.expired) q = q.lt('due_date', c.today)
  const { data } = await q
  let rows = (data ?? []) as any[]
  if (it.customer) rows = rows.filter(t => (t.customer?.name ?? '').toLowerCase().includes(it.customer!.toLowerCase()) || t.title.toLowerCase().includes(it.customer!.toLowerCase()))
  const late = rows.filter(t => t.due_date && t.due_date < c.today)
  return {
    summary: rows.length ? `${rows.length} open service ticket${rows.length === 1 ? '' : 's'}${late.length ? `, ${late.length} overdue` : ''}` : 'No open service tickets.',
    stats: rows.length ? [{ label: 'Open', value: String(rows.length), tone: 'blue' }, { label: 'Overdue', value: String(late.length), tone: late.length ? 'red' : 'green' }, { label: 'Under warranty', value: String(rows.filter(t => t.under_warranty).length) }] : undefined,
    results: rows.map(t => ({ title: `${t.number} · ${t.title}`, sub: [t.customer?.name, t.priority !== 'normal' ? `${t.priority} priority` : null, t.due_date ? `due ${formatShortDate(t.due_date)}` : null, t.under_warranty ? 'under warranty' : null].filter(Boolean).join(' · '),
      href: `/tickets/${t.id}`, badge: late.includes(t) ? 'overdue' : t.status.replace('_', ' '), tone: late.includes(t) ? 'red' : 'blue' })),
  }
}

export async function leads(c: Ctx, it: SearchIntent): Promise<Out> {
  if (!c.can('crm.view')) return { summary: 'You do not have access to leads.', results: [] }
  let q = c.supabase.from('leads').select('id,number,company_name,stage,estimated_value,next_followup,source').is('deleted_at', null).not('stage', 'in', '(won,lost)').order('estimated_value', { ascending: false, nullsFirst: false }).limit(100)
  if (it.customer) q = q.ilike('company_name', like(it.customer))
  if (it.expired) q = q.lt('next_followup', c.today)
  const { data } = await q
  const rows = data ?? [], value = rows.reduce((a, r) => a + n(r.estimated_value), 0), due = rows.filter(r => r.next_followup && r.next_followup <= c.today)
  return {
    summary: rows.length ? `${rows.length} open lead${rows.length === 1 ? '' : 's'} worth ${formatAed(value)}${due.length ? `, ${due.length} follow-up${due.length === 1 ? '' : 's'} due` : ''}` : 'No open leads.',
    stats: rows.length ? [{ label: 'Pipeline value', value: formatAed(value), tone: 'blue' }, { label: 'Follow-ups due', value: String(due.length), tone: due.length ? 'amber' : 'green' }] : undefined,
    results: rows.map(l => ({ title: `${l.number} · ${l.company_name}`, sub: [l.stage.replace(/_/g, ' '), l.estimated_value ? formatAed(n(l.estimated_value)) : null, l.next_followup ? `follow up ${formatShortDate(l.next_followup)}` : null, l.source?.replace(/_/g, ' ')].filter(Boolean).join(' · '),
      href: `/leads/${l.id}`, badge: l.next_followup && l.next_followup <= c.today ? 'follow up' : undefined, tone: 'amber' })),
  }
}
