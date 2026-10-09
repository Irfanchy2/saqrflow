import type { Tone } from '@/components/ui/primitives'
import { LEAD_STAGES, TASK_STATUS, WO_STATUS } from '@/lib/crm'
import { PROJECT_STATUS } from '@/lib/projects'

// Custom fields (Settings → Custom fields) and custom statuses. Values are validated here and stored per record in custom_field_values.
export const CUSTOM_ENTITIES = { customer: 'Customers', project: 'Projects', employee: 'Employees', asset: 'Vehicles & assets', lead: 'Leads', task: 'Tasks', work_order: 'Work orders' } as const
export type CustomEntity = keyof typeof CUSTOM_ENTITIES
export const FIELD_TYPES = { text: 'Text', textarea: 'Long text', number: 'Number', date: 'Date', select: 'Dropdown', checkbox: 'Yes / no' } as const
export type FieldType = keyof typeof FIELD_TYPES
export interface FieldDef { id: string; entity: string; key: string; label: string; field_type: FieldType; options: string[]; required: boolean; position: number; active: boolean }

// custom statuses map onto the built-in status that drives the workflow (overdue, open/closed, pipeline value…)
export const STATUS_ENTITIES = { task: 'Tasks', project: 'Projects', lead: 'Leads', work_order: 'Work orders' } as const
export type StatusEntity = keyof typeof STATUS_ENTITIES
export const BASE_STATUSES: Record<StatusEntity, Record<string, string>> = {
  task: Object.fromEntries(Object.entries(TASK_STATUS).map(([k, v]) => [k, v.label])),
  project: Object.fromEntries(Object.entries(PROJECT_STATUS).map(([k, v]) => [k, v.label])),
  lead: Object.fromEntries(LEAD_STAGES.map(s => [s.key, s.label])),
  work_order: Object.fromEntries(Object.entries(WO_STATUS).map(([k, v]) => [k, v.label])),
}
export const STATUS_COLORS: Record<string, Tone> = { neutral: 'neutral', blue: 'blue', green: 'green', amber: 'amber', red: 'red' }
export const STATUS_TABLE: Record<StatusEntity, string> = { task: 'tasks', project: 'projects', lead: 'leads', work_order: 'work_orders' }
export const ENTITY_TABLE: Record<CustomEntity, string> = { customer: 'customers', project: 'projects', employee: 'employees', asset: 'assets', lead: 'leads', task: 'tasks', work_order: 'work_orders' }

/** "Site supervisor" → site_supervisor (unique per entity). */
export const fieldKey = (label: string) => label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40) || 'field'

/** Turns submitted form values into a clean object, or the first problem found. Unknown keys are dropped. */
export function parseCustomValues(defs: FieldDef[], get: (k: string) => FormDataEntryValue | null): { values: Record<string, string | number | boolean | null> } | { error: string } {
  const out: Record<string, string | number | boolean | null> = {}
  for (const d of defs.filter(x => x.active)) {
    const raw = get(`cf_${d.key}`), s = typeof raw === 'string' ? raw.trim() : ''
    if (d.field_type === 'checkbox') { out[d.key] = raw === 'on'; continue }
    if (!s) { if (d.required) return { error: `${d.label} is required.` }; out[d.key] = null; continue }
    if (d.field_type === 'number') { const n = Number(s); if (!Number.isFinite(n)) return { error: `${d.label}: enter a number.` }; out[d.key] = n }
    else if (d.field_type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return { error: `${d.label}: enter a valid date.` }; out[d.key] = s }
    else if (d.field_type === 'select') { if (!d.options.includes(s)) return { error: `${d.label}: choose one of the options.` }; out[d.key] = s }
    else out[d.key] = s.slice(0, d.field_type === 'textarea' ? 4000 : 300)
  }
  return { values: out }
}

export function displayValue(d: FieldDef, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (d.field_type === 'checkbox') return v ? 'Yes' : 'No'
  if (d.field_type === 'date' && typeof v === 'string') return new Date(v + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return String(v)
}
