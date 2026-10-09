import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatAed, todayInTz } from './time'
import { sanitizeParam } from './whatsapp/templates'
import { channelOk } from './event-worker'
import { appUrl } from './portal'
import { isDue, latestOccurrence, SECTIONS, type Occurrence, type Schedule, type Section } from './report-periods'

type Admin = SupabaseClient
export type ScheduleRow = Schedule & { id: string; company_id: string; name: string; sections: Section[]; channels: string[]; recipient_ids: string[]; enabled: boolean; last_period: string | null }

const sum = (rows: { [k: string]: any }[] | null | undefined, k: string) => Math.round((rows ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0) * 100) / 100
const OPEN_INVOICE = ['sent', 'viewed', 'follow_up', 'partially_paid', 'overdue']

/** The figures for one period, read with an explicit company filter (service role). Returns the lines of the report. */
export async function buildReport(admin: Admin, companyId: string, sections: Section[], from: string, to: string, today: string) {
  const want = new Set(sections), lines: string[] = [], head = { count: 'exact' as const, head: true }
  const out = { invoiced: 0, collected: 0, outstanding: 0 }
  const inv = () => admin.from('invoices').select('id,total,status').eq('company_id', companyId).is('deleted_at', null)
  if (want.has('sales')) {
    const [{ data: invs }, { data: qts }] = await Promise.all([
      inv().eq('doc_type', 'invoice').not('status', 'in', '(draft,cancelled)').gte('issue_date', from).lte('issue_date', to).limit(20000),
      inv().eq('doc_type', 'quotation').not('status', 'in', '(draft,cancelled)').gte('issue_date', from).lte('issue_date', to).limit(20000),
    ])
    out.invoiced = sum(invs, 'total')
    const accepted = (qts ?? []).filter(q => q.status === 'accepted' || q.status === 'converted')
    lines.push('SALES', `Tax invoices issued: ${(invs ?? []).length} · ${formatAed(out.invoiced)}`,
      `Quotations issued: ${(qts ?? []).length} · ${formatAed(sum(qts, 'total'))}`, `Quotations accepted: ${accepted.length} · ${formatAed(sum(accepted, 'total'))}`, '')
  }
  if (want.has('collections') || want.has('sales')) {
    const { data: pays } = await admin.from('payments').select('amount').eq('company_id', companyId).gte('paid_on', from).lte('paid_on', to).limit(20000)
    out.collected = sum(pays, 'amount')
    if (want.has('collections')) lines.push('COLLECTIONS', `Payments received: ${(pays ?? []).length} · ${formatAed(out.collected)}`, '')
  }
  if (want.has('expenses')) {
    const { data: ex } = await admin.from('project_expenses').select('amount,category').eq('company_id', companyId).gte('spent_on', from).lte('spent_on', to).limit(20000)
    const byCat = new Map<string, number>(); for (const e of ex ?? []) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount))
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k.replace(/_/g, ' ')} ${formatAed(v)}`)
    lines.push('EXPENSES', `Recorded: ${(ex ?? []).length} · ${formatAed(sum(ex, 'amount'))}`, ...(top.length ? [`Largest: ${top.join(' · ')}`] : []), '')
  }
  {   // receivables are "as of today" (also used by the WhatsApp summary)
    const { data: open } = await admin.from('invoices').select('id,due_date').eq('company_id', companyId).eq('doc_type', 'invoice').is('deleted_at', null).in('status', OPEN_INVOICE).limit(20000)
    const ids = (open ?? []).map(o => o.id), bal = new Map<string, number>()
    for (let i = 0; i < ids.length; i += 200) { const { data } = await admin.from('invoice_balances').select('id,balance').in('id', ids.slice(i, i + 200)); for (const b of data ?? []) bal.set(b.id, Number(b.balance)) }
    const owing = (open ?? []).filter(o => (bal.get(o.id) ?? 0) > 0.004), overdue = owing.filter(o => o.due_date && o.due_date < today)
    out.outstanding = Math.round(owing.reduce((a, o) => a + (bal.get(o.id) ?? 0), 0) * 100) / 100
    if (want.has('receivables')) lines.push(`RECEIVABLES (as of ${today})`, `Outstanding: ${owing.length} invoice(s) · ${formatAed(out.outstanding)}`,
      `Overdue: ${overdue.length} invoice(s) · ${formatAed(overdue.reduce((a, o) => a + (bal.get(o.id) ?? 0), 0))}`, '')
  }
  if (want.has('crm')) {
    const [created, { data: won }] = await Promise.all([
      admin.from('leads').select('id', head).eq('company_id', companyId).is('deleted_at', null).gte('created_at', `${from}T00:00:00Z`).lte('created_at', `${to}T23:59:59Z`),
      admin.from('leads').select('estimated_value').eq('company_id', companyId).is('deleted_at', null).eq('stage', 'won').gte('won_at', `${from}T00:00:00Z`).lte('won_at', `${to}T23:59:59Z`).limit(5000),
    ])
    lines.push('LEADS', `New leads: ${created.count ?? 0}`, `Won: ${(won ?? []).length} · ${formatAed(sum(won, 'estimated_value'))}`, '')
  }
  if (want.has('service')) {
    const t = () => admin.from('service_tickets').select('id', head).eq('company_id', companyId).is('deleted_at', null)
    const [opened, resolved, open, late] = await Promise.all([
      t().gte('created_at', `${from}T00:00:00Z`).lte('created_at', `${to}T23:59:59Z`), t().gte('resolved_at', `${from}T00:00:00Z`).lte('resolved_at', `${to}T23:59:59Z`),
      t().in('status', ['open', 'scheduled', 'in_progress', 'waiting_customer']), t().in('status', ['open', 'scheduled', 'in_progress', 'waiting_customer']).lt('due_date', today),
    ])
    lines.push('SERVICE', `Tickets opened: ${opened.count ?? 0} · resolved: ${resolved.count ?? 0}`, `Open now: ${open.count ?? 0} (overdue ${late.count ?? 0})`, '')
  }
  return { lines, ...out }
}

/** Queues the report for every recipient × channel. `manual` sends get their own key so "Send now" never blocks the schedule. */
export async function sendSchedule(admin: Admin, s: ScheduleRow, occ: Occurrence, today: string, manual = false) {
  const r = await buildReport(admin, s.company_id, s.sections, occ.from, occ.to, today)
  const { data: recs } = await admin.from('notification_recipients').select('id,user_id,email,whatsapp_number,whatsapp_opt_in,is_active').eq('company_id', s.company_id).in('id', s.recipient_ids)
  const base = appUrl(), link = `/reports?period=custom&from=${occ.from}&to=${occ.to}`
  const text = [`${s.name}`, `Period: ${occ.label}`, '', ...r.lines, base ? `Full reports: ${base}${link}` : 'Open Averiqo → Reports for the full figures.'].join('\n')
  const params = { report: sanitizeParam(s.name), period: sanitizeParam(occ.label), invoiced: formatAed(r.invoiced), collected: formatAed(r.collected), outstanding: formatAed(r.outstanding),
    _title: `${s.name} · ${occ.label}`.slice(0, 200), _link: link, _severity: 'info', _subject: `${s.name} · ${occ.label}`.slice(0, 150), _text: text }
  const key = manual ? `manual:${Date.now()}` : occ.key
  const rows = (recs ?? []).flatMap((rec: any) => s.channels.filter(ch => channelOk(ch, rec)).map(ch => ({
    company_id: s.company_id, recipient_id: rec.id, channel: ch, template: 'scheduled_report', params, source_type: 'report', source_id: s.id, dedupe_key: `report:${s.id}:${key}:${ch}:${rec.id}`,
  })))
  if (rows.length) { const { error } = await admin.from('notification_logs').upsert(rows, { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true }); if (error) throw error }
  return { queued: rows.length, text }
}

/** Scheduler: sends every schedule whose latest occurrence has not gone out yet. */
export async function runDueSchedules(admin: Admin, now = new Date()) {
  const { data: rows, error } = await admin.from('report_schedules').select('*, company:companies(timezone)').eq('enabled', true).limit(1000)
  if (error) throw error
  let sent = 0, queued = 0
  for (const s of (rows ?? []) as (ScheduleRow & { company: { timezone: string } | null })[]) {
    const today = todayInTz(now, s.company?.timezone ?? 'Asia/Dubai')
    if (!isDue(s, today)) continue
    const occ = latestOccurrence(s, today)
    const r = await sendSchedule(admin, s, occ, today)
    await admin.from('report_schedules').update({ last_period: occ.key, last_sent_at: now.toISOString() }).eq('id', s.id)
    sent++; queued += r.queued
  }
  return { reports: sent, messages: queued }
}
export { SECTIONS }
