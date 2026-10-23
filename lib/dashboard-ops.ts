// Dashboard maths for the operations panels (pure, unit-tested): the sales funnel, on-time completion,
// how far along a work order is, and the order book still to invoice.

/** Funnel steps: each lead counts in the furthest step it has reached (won leads count in every step). */
export const FUNNEL = [
  { key: 'enquiry', label: 'Enquiries', stages: ['new', 'contacted'] },
  { key: 'visit', label: 'Site visits', stages: ['site_visit_required', 'site_visit_completed'] },
  { key: 'quote', label: 'Quoted', stages: ['quotation_preparation', 'quotation_sent', 'follow_up'] },
  { key: 'negotiation', label: 'Negotiation', stages: ['negotiation'] },
  { key: 'won', label: 'Won', stages: ['won'] },
] as const
export interface FunnelStep { key: string; label: string; count: number; value: number; pct: number }

/** Leads that reached at least each step (lost / on hold count for the steps before they stopped, when known). */
export function salesFunnel(leads: { stage: string; estimated_value?: number | string | null; reached?: string | null }[]): FunnelStep[] {
  const depth = (stage: string) => FUNNEL.findIndex(f => (f.stages as readonly string[]).includes(stage))
  const steps = FUNNEL.map(f => ({ key: f.key, label: f.label, count: 0, value: 0, pct: 0 }))
  for (const l of leads) {
    const d = depth(l.stage === 'lost' || l.stage === 'on_hold' ? l.reached ?? 'new' : l.stage)
    if (d < 0) continue
    for (let i = 0; i <= d; i++) { steps[i].count++; steps[i].value += Number(l.estimated_value ?? 0) }
  }
  const top = steps[0].count || 1
  for (const s of steps) s.pct = Math.round((s.count / top) * 100)
  return steps
}

/** Share of work orders finished by their target date (only those with a target and a completion). null when none. */
export function onTimeRate(rows: { target_date: string | null; completed_at: string | null }[], tz = 'Asia/Dubai'): { pct: number | null; onTime: number; total: number } {
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  const done = rows.filter(r => r.target_date && r.completed_at)
  const onTime = done.filter(r => day(r.completed_at!) <= r.target_date!).length
  return { pct: done.length ? Math.round((onTime / done.length) * 100) : null, onTime, total: done.length }
}

/** Where a work order is on the shop floor, as a share of the way to completed. */
export const WO_STEPS = ['pending', 'approved', 'scheduled', 'in_fabrication', 'ready_for_site', 'installation', 'inspection', 'completed'] as const
export const WO_LABEL: Record<string, string> = { pending: 'Pending', approved: 'Approved', scheduled: 'Scheduled', in_fabrication: 'In fabrication', ready_for_site: 'Ready for site', installation: 'Installation', inspection: 'Inspection', completed: 'Completed', on_hold: 'On hold', cancelled: 'Cancelled' }
export function woProgress(status: string): number {
  const i = WO_STEPS.indexOf(status as (typeof WO_STEPS)[number])
  return i < 0 ? 0 : Math.round((i / (WO_STEPS.length - 1)) * 100)
}

/** Contract value of open projects not yet invoiced (never below zero per project). */
export function orderBook(projects: { id: string; contract_value: number | string | null }[], invoiced: { project_id: string | null; total: number | string; vat_amount?: number | string | null }[]): { value: number; projects: number } {
  const billed = new Map<string, number>()
  for (const i of invoiced) if (i.project_id) billed.set(i.project_id, (billed.get(i.project_id) ?? 0) + Number(i.total) - Number(i.vat_amount ?? 0))
  let value = 0, n = 0
  for (const p of projects) { const left = Number(p.contract_value ?? 0) - (billed.get(p.id) ?? 0); if (left > 0) { value += left; n++ } }
  return { value: Math.round(value * 100) / 100, projects: n }
}
