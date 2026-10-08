// CRM + field operations: shared vocabularies and pure helpers (unit-tested). Nothing here invents data:
// every figure is computed from recorded rows, and missing inputs are reported as missing.
import { addDays, daysBetween } from './time'

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red'

// ───────────── leads ─────────────
/** Pipeline order. `prob` is the default win probability used only when the salesperson has not entered one. */
export const LEAD_STAGES = [
  { key: 'new', label: 'New', tone: 'neutral', prob: 10 },
  { key: 'contacted', label: 'Contacted', tone: 'neutral', prob: 15 },
  { key: 'site_visit_required', label: 'Site visit required', tone: 'blue', prob: 20 },
  { key: 'site_visit_completed', label: 'Site visit done', tone: 'blue', prob: 30 },
  { key: 'quotation_preparation', label: 'Preparing quotation', tone: 'blue', prob: 40 },
  { key: 'quotation_sent', label: 'Quotation sent', tone: 'blue', prob: 50 },
  { key: 'negotiation', label: 'Negotiation', tone: 'amber', prob: 65 },
  { key: 'follow_up', label: 'Follow-up', tone: 'amber', prob: 45 },
  { key: 'won', label: 'Won', tone: 'green', prob: 100 },
  { key: 'lost', label: 'Lost', tone: 'neutral', prob: 0 },
  { key: 'on_hold', label: 'On hold', tone: 'neutral', prob: 0 },
] as const satisfies readonly { key: string; label: string; tone: Tone; prob: number }[]
export type LeadStage = (typeof LEAD_STAGES)[number]['key']
export const STAGE_KEYS = LEAD_STAGES.map(s => s.key) as [LeadStage, ...LeadStage[]]
export const STAGE = Object.fromEntries(LEAD_STAGES.map(s => [s.key, s])) as Record<LeadStage, (typeof LEAD_STAGES)[number]>
export const CLOSED_STAGES: readonly string[] = ['won', 'lost', 'on_hold']

export const LEAD_SOURCES: Record<string, string> = {
  website: 'Website', google: 'Google', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', referral: 'Referral',
  existing_customer: 'Existing customer', walk_in: 'Walk-in', tender: 'Tender', cold_call: 'Cold call', other: 'Other',
}
export const LOST_REASONS: Record<string, string> = {
  price: 'Price too high', competitor: 'Went with a competitor', cancelled: 'Project cancelled', no_response: 'No response',
  timeline: 'Timeline did not fit', specification: 'Specification mismatch', customer_decision: 'Customer decision', other: 'Other',
}
export const ACTIVITY_KINDS: Record<string, string> = {
  note: 'Note', call: 'Call', whatsapp: 'WhatsApp', email: 'Email', meeting: 'Meeting', stage: 'Stage change',
  site_visit: 'Site visit', quotation: 'Quotation', converted: 'Converted',
}
export const SERVICES = ['Staircase', 'Handrail / balustrade', 'Gate', 'Fence', 'Pergola', 'Canopy / shade', 'Mezzanine floor', 'Steel structure', 'Cladding', 'Cabinet / enclosure', 'Repair / maintenance', 'Other']

export interface LeadLite { stage: string; source?: string; estimated_value?: number | string | null; probability?: number | null; created_at?: string; next_followup?: string | null }
export const leadProbability = (l: LeadLite) => l.probability ?? STAGE[l.stage as LeadStage]?.prob ?? 0
export const isOpenLead = (l: { stage: string }) => !CLOSED_STAGES.includes(l.stage)

/** Pipeline value (open leads only) and probability-weighted value. Leads without a value count but add nothing. */
export function pipelineSummary(leads: LeadLite[]) {
  const open = leads.filter(isOpenLead)
  const value = open.reduce((s, l) => s + Number(l.estimated_value ?? 0), 0)
  const weighted = open.reduce((s, l) => s + Number(l.estimated_value ?? 0) * leadProbability(l) / 100, 0)
  const byStage = Object.fromEntries(LEAD_STAGES.map(s => [s.key, { count: 0, value: 0 }])) as Record<string, { count: number; value: number }>
  for (const l of leads) { const b = byStage[l.stage]; if (b) { b.count++; b.value += Number(l.estimated_value ?? 0) } }
  const won = leads.filter(l => l.stage === 'won').length, lost = leads.filter(l => l.stage === 'lost').length
  return { open: open.length, value: round2(value), weighted: round2(weighted), byStage, won, lost, unvalued: open.filter(l => l.estimated_value == null).length,
    winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null }
}

/** Per-source performance. Conversion = won ÷ decided (won + lost); null until something is decided. */
export function sourceAnalytics(leads: LeadLite[]) {
  const rows = new Map<string, { source: string; leads: number; open: number; won: number; lost: number; wonValue: number; pipeline: number }>()
  for (const l of leads) {
    const k = l.source ?? 'other'
    const r = rows.get(k) ?? { source: k, leads: 0, open: 0, won: 0, lost: 0, wonValue: 0, pipeline: 0 }
    r.leads++
    if (l.stage === 'won') { r.won++; r.wonValue += Number(l.estimated_value ?? 0) }
    else if (l.stage === 'lost') r.lost++
    else if (isOpenLead(l)) { r.open++; r.pipeline += Number(l.estimated_value ?? 0) }
    rows.set(k, r)
  }
  return [...rows.values()].map(r => ({ ...r, wonValue: round2(r.wonValue), pipeline: round2(r.pipeline), conversion: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : null }))
    .sort((a, b) => b.leads - a.leads)
}

/** Follow-up state for a lead card: overdue / today / upcoming / none (closed leads never nag). */
export function followupState(l: { stage: string; next_followup?: string | null }, today: string): 'overdue' | 'today' | 'soon' | 'later' | 'none' {
  if (!l.next_followup || !isOpenLead(l)) return 'none'
  const d = daysBetween(today, l.next_followup)
  return d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 3 ? 'soon' : 'later'
}

// ───────────── site visits ─────────────
export const VISIT_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'blue' }, completed: { label: 'Completed', tone: 'green' }, rescheduled: { label: 'Rescheduled', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'neutral' }, follow_up_required: { label: 'Follow-up required', tone: 'amber' },
}

// ───────────── work orders ─────────────
export const WO_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' }, approved: { label: 'Approved', tone: 'blue' }, scheduled: { label: 'Scheduled', tone: 'blue' },
  in_fabrication: { label: 'In fabrication', tone: 'blue' }, ready_for_site: { label: 'Ready for site', tone: 'blue' }, installation: { label: 'Installation', tone: 'blue' },
  inspection: { label: 'Inspection', tone: 'amber' }, completed: { label: 'Completed', tone: 'green' }, on_hold: { label: 'On hold', tone: 'amber' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
}
export const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  low: { label: 'Low', tone: 'neutral' }, normal: { label: 'Normal', tone: 'neutral' }, high: { label: 'High', tone: 'amber' }, urgent: { label: 'Urgent', tone: 'red' },
}

// ───────────── tasks ─────────────
export const TASK_STATUS: Record<string, { label: string; tone: Tone }> = {
  todo: { label: 'To do', tone: 'neutral' }, in_progress: { label: 'In progress', tone: 'blue' }, waiting: { label: 'Waiting', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
}
export const OPEN_TASK: readonly string[] = ['todo', 'in_progress', 'waiting']
/** "Overdue" is derived (an open task past its due date), never stored, so it can't go stale. */
export const isOverdue = (t: { status: string; due_date?: string | null }, today: string) => OPEN_TASK.includes(t.status) && !!t.due_date && t.due_date < today
export function taskBucket(t: { status: string; due_date?: string | null }, today: string): 'done' | 'overdue' | 'today' | 'week' | 'later' | 'unscheduled' {
  if (!OPEN_TASK.includes(t.status)) return 'done'
  if (!t.due_date) return 'unscheduled'
  if (t.due_date < today) return 'overdue'
  if (t.due_date === today) return 'today'
  return t.due_date <= addDays(today, 6) ? 'week' : 'later'
}
/** Work-order completion from its tasks (cancelled tasks are ignored); null when it has none. */
export function tasksCompletion(tasks: { status: string; completion?: number | null }[]) {
  const live = tasks.filter(t => t.status !== 'cancelled')
  if (!live.length) return null
  return Math.round(live.reduce((s, t) => s + (t.status === 'completed' ? 100 : Number(t.completion ?? 0)), 0) / live.length)
}

// ───────────── project progress & cost control ─────────────
/**
 * Overall = the value the PM entered, else a weighted mix of the entered dimensions
 * (fabrication 45 %, installation 45 %, inspection 10 %). Commercial = invoiced ÷ contract, null without a contract value.
 */
export function projectProgress(p: { fabrication_progress?: number | null; site_progress?: number | null; inspection_progress?: number | null; overall_progress?: number | null }, billedPct: number | null) {
  const fab = p.fabrication_progress ?? 0, inst = p.site_progress ?? 0, insp = p.inspection_progress ?? 0
  const derived = Math.round(fab * 0.45 + inst * 0.45 + insp * 0.1)
  return { overall: p.overall_progress ?? derived, derived: p.overall_progress == null, fabrication: fab, installation: inst, inspection: insp, commercial: billedPct }
}

export interface CostLine { category: string; budget: number | null; actual: number; variance: number | null; usedPct: number | null }
/**
 * Budget vs recorded cost per category. Missing inputs are listed, never filled in: when there is no contract value,
 * no estimate or no cost of a kind the job obviously has (materials, labour), the screen shows "Cost data incomplete".
 */
export function costControl(input: { contract: number; budgets: { category: string; amount: number | string }[]; byCategory: Record<string, number>; status?: string; started?: boolean }) {
  const budget = new Map(input.budgets.map(b => [b.category, Number(b.amount)]))
  const cats = [...new Set([...budget.keys(), ...Object.keys(input.byCategory)])]
  const lines: CostLine[] = cats.map(k => {
    const b = budget.has(k) ? budget.get(k)! : null, a = round2(input.byCategory[k] ?? 0)
    return { category: k, budget: b, actual: a, variance: b == null ? null : round2(b - a), usedPct: b ? Math.round((a / b) * 100) : null }
  }).sort((x, y) => (y.budget ?? y.actual) - (x.budget ?? x.actual))
  const estimated = [...budget.values()].reduce((s, v) => s + v, 0)
  const actual = Object.values(input.byCategory).reduce((s, v) => s + v, 0)
  const missing: string[] = []
  if (!input.contract) missing.push('Contract value')
  if (!budget.size) missing.push('Estimated cost (budget)')
  if (input.started !== false) {
    if (!input.byCategory.material) missing.push('Material costs')
    if (!input.byCategory.labour) missing.push('Labour costs')
  }
  const overruns = lines.filter(l => l.budget != null && l.actual > l.budget)
  return {
    lines, estimated: round2(estimated), actual: round2(actual), remaining: budget.size ? round2(estimated - actual) : null,
    estimatedProfit: input.contract && budget.size ? round2(input.contract - estimated) : null,
    forecastProfit: input.contract ? round2(input.contract - Math.max(estimated, actual)) : null,
    usedPct: estimated ? Math.round((actual / estimated) * 100) : null, missing, complete: missing.length === 0, overruns,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
