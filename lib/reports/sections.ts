// Report sections: one definition per section turns report_summary() JSON into tables. The page and every export
// (CSV, Excel, PDF) use these same tables, so a printed or exported report always matches the screen.
import { formatShortDate } from '../time'

export const SECTIONS = [
  ['overview', 'Overview', 'any'], ['sales', 'Sales', 'finance'], ['quotations', 'Quotations', 'finance'], ['receivables', 'Receivables', 'finance'],
  ['projects', 'Projects', 'finance'], ['compliance', 'Documents & staff', 'any'], ['resources', 'Vehicles & assets', 'any'], ['cheques', 'Cheques', 'finance'],
] as const
export type SectionKey = typeof SECTIONS[number][0]

export type Cell = string | number | null
export interface Column { label: string; num?: boolean; money?: boolean; pct?: boolean }
export interface Table { title: string; columns: Column[]; rows: Cell[][]; links?: (string | null)[]; totals?: Cell[]; note?: string }

type J = Record<string, any>
const n = (v: unknown) => Number(v ?? 0)
const r2 = (v: number) => Math.round(v * 100) / 100
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)
const month = (ym: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(ym + '-01T00:00:00Z'))
export const STATUS_ORDER = ['draft', 'sent', 'viewed', 'follow_up', 'accepted', 'converted', 'rejected', 'expired', 'cancelled'] as const
const QLABEL: Record<string, string> = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', follow_up: 'Follow-up', accepted: 'Accepted', converted: 'Converted', rejected: 'Rejected', expired: 'Expired', cancelled: 'Cancelled' }

export function conversionRate(q: J | undefined) { return q ? pct(n(q.won), n(q.decided)) : null }

/** Project profit is only stated when the cost side is complete enough to mean something. */
export function projectProfit(p: J) {
  const invoiced = n(p.invoiced), expenses = n(p.expenses)
  const complete = !!p.labour_recorded && !!p.material_recorded
  const profit = r2(invoiced - expenses)
  return { invoiced, expenses, received: n(p.received), outstanding: r2(Math.max(0, n(p.invoiced_total) - n(p.received))), profit, margin: invoiced > 0 ? pct(profit, invoiced) : null, complete, actual: complete && p.status === 'completed' ? profit : null }
}

export function sectionTables(key: SectionKey, s: J, today: string): Table[] {
  switch (key) {
    case 'sales': {
      const monthly = (s.monthly ?? []) as J[]
      return [
        { title: 'Invoiced and received by month (last 12 months)', columns: [{ label: 'Month' }, { label: 'Invoices', num: true }, { label: 'Invoiced excl. VAT', money: true }, { label: 'Invoiced incl. VAT', money: true }, { label: 'Received', money: true }],
          rows: monthly.map(m => [month(m.month), n(m.count), n(m.net), n(m.total), n(m.received)]),
          totals: ['Total', monthly.reduce((a, m) => a + n(m.count), 0), r2(monthly.reduce((a, m) => a + n(m.net), 0)), r2(monthly.reduce((a, m) => a + n(m.total), 0)), r2(monthly.reduce((a, m) => a + n(m.received), 0))] },
        { title: 'Top customers in this period', columns: [{ label: 'Customer' }, { label: 'Invoices', num: true }, { label: 'Revenue excl. VAT', money: true }, { label: 'Incl. VAT', money: true }, { label: 'Quotations', num: true }, { label: 'Accepted', num: true }, { label: 'Conversion', pct: true }],
          rows: (s.top_customers ?? []).map((c: J) => [c.name, n(c.count), n(c.net), n(c.total), n(c.quotes), n(c.quotes_won), pct(n(c.quotes_won), n(c.quotes))]),
          links: (s.top_customers ?? []).map((c: J) => (c.id ? `/parties/${c.id}` : null)) },
        { title: 'Revenue by project in this period', columns: [{ label: 'Project' }, { label: 'Invoices', num: true }, { label: 'Revenue excl. VAT', money: true }],
          rows: (s.by_project ?? []).map((p: J) => [p.code ? `${p.code} ${p.name}` : p.name, n(p.count), n(p.net)]), links: (s.by_project ?? []).map((p: J) => `/projects/${p.id}`) },
      ]
    }
    case 'quotations': {
      const q = s.quotations ?? {}, by = q.by_status ?? {}
      return [
        { title: 'Quotations issued in this period by status', columns: [{ label: 'Status' }, { label: 'Count', num: true }, { label: 'Value', money: true }],
          rows: STATUS_ORDER.filter(k => by[k]).map(k => [QLABEL[k], n(by[k].n), n(by[k].v)]), totals: ['Total', n(q.count), n(q.value)] },
        { title: 'Monthly trend (last 12 months)', columns: [{ label: 'Month' }, { label: 'Quotations', num: true }, { label: 'Quoted value', money: true }, { label: 'Accepted', num: true }],
          rows: (s.quote_monthly ?? []).map((m: J) => [month(m.month), n(m.count), n(m.value), n(m.won)]) },
      ]
    }
    case 'receivables': {
      const rv = s.receivables ?? {}
      return [
        { title: `Ageing on ${formatShortDate(today)}`, columns: [{ label: 'Bucket' }, { label: 'Outstanding', money: true }, { label: 'Share', pct: true }],
          rows: [['Not yet due', n(rv.current)], ['1-30 days overdue', n(rv.d30)], ['31-60 days overdue', n(rv.d60)], ['61-90 days overdue', n(rv.d90)], ['Over 90 days', n(rv.over90)]].map(([l, v]) => [l as string, v as number, pct(v as number, n(rv.total))]),
          totals: ['Total outstanding', n(rv.total), n(rv.total) ? 100 : null] },
        { title: 'Open invoices', columns: [{ label: 'Invoice' }, { label: 'Customer' }, { label: 'Due date' }, { label: 'Days overdue', num: true }, { label: 'Outstanding', money: true }],
          rows: (rv.rows ?? []).map((x: J) => [x.number, x.customer, x.due_date ? formatShortDate(x.due_date) : 'No due date', n(x.late), n(x.balance)]),
          links: (rv.rows ?? []).map((x: J) => `/invoices/${x.id}`), totals: ['Total', null, null, null, n(rv.total)],
          note: n(rv.count) > (rv.rows ?? []).length ? `Showing the ${(rv.rows ?? []).length} oldest of ${n(rv.count)} open invoices.` : undefined },
      ]
    }
    case 'projects': {
      const rows = ((s.projects?.rows ?? []) as J[]).map(p => ({ p, x: projectProfit(p) }))
      return [{ title: 'Projects: value, billing, collection and recorded costs', columns: [{ label: 'Project' }, { label: 'Status' }, { label: 'Contract value', money: true }, { label: 'Invoiced excl. VAT', money: true }, { label: 'Received', money: true }, { label: 'Outstanding', money: true }, { label: 'Expenses', money: true }, { label: 'Est. profit', money: true }, { label: 'Margin', pct: true }, { label: 'Cost data' }],
        rows: rows.map(({ p, x }) => [p.code ? `${p.code} ${p.name}` : p.name, String(p.status).replace('_', ' '), p.value == null ? null : n(p.value), x.invoiced, x.received, x.outstanding, x.expenses, x.profit, x.margin, x.complete ? (x.actual != null ? 'Complete (actual profit)' : 'Complete') : 'Incomplete cost data']),
        links: rows.map(({ p }) => `/projects/${p.id}`),
        totals: ['Total', null, r2(rows.reduce((a, { p }) => a + n(p.value), 0)), r2(rows.reduce((a, { x }) => a + x.invoiced, 0)), r2(rows.reduce((a, { x }) => a + x.received, 0)), r2(rows.reduce((a, { x }) => a + x.outstanding, 0)), r2(rows.reduce((a, { x }) => a + x.expenses, 0)), r2(rows.reduce((a, { x }) => a + x.profit, 0)), null, null],
        note: 'Est. profit = invoiced excl. VAT minus recorded expenses. It is only complete when labour and material costs are recorded for the project.' }]
    }
    case 'compliance': {
      const d = s.documents ?? {}, groups: [string, string][] = [['company', 'Company documents'], ['employee', 'Employee documents'], ['vehicle', 'Vehicle documents'], ['asset', 'Asset certifications']]
      const e = s.employees ?? {}, ex = e.expiring ?? {}
      return [
        { title: `Document expiry on ${formatShortDate(today)}`, columns: [{ label: 'Group' }, { label: 'Expired', num: true }, { label: 'In 7 days', num: true }, { label: 'In 30 days', num: true }, { label: 'In 60 days', num: true }, { label: 'In 90 days', num: true }, { label: 'Renewal in progress', num: true }],
          rows: groups.map(([k, l]) => [l, n(d[k]?.expired), n(d[k]?.d7), n(d[k]?.d30), n(d[k]?.d60), n(d[k]?.d90), n(d[k]?.renewal)]),
          links: groups.map(([k]) => `/vault?owner=${k === 'vehicle' ? 'vehicle' : k === 'asset' ? 'resource' : k}`),
          totals: ['Total', ...(['expired', 'd7', 'd30', 'd60', 'd90', 'renewal'] as const).map(f => groups.reduce((a, [k]) => a + n(d[k]?.[f]), 0))] },
        { title: 'Employee compliance (expired or due within 60 days)', columns: [{ label: 'Measure' }, { label: 'Employees / documents', num: true }],
          rows: [['Active employees', n(e.active)], ['Visas', n(ex.visa)], ['Passports', n(ex.passport)], ['Emirates IDs', n(ex.emirates_id)], ['Work permits / labour cards', n(ex.work_permit)], ['Insurance', n(ex.insurance)], ['Staff missing a required document', n(e.missing_staff)]],
          note: 'Required documents: Passport, Emirates ID, Residence Visa, Work Permit, Labour Contract and Medical Insurance.' },
      ]
    }
    case 'resources': {
      const r = s.resources ?? {}
      return [
        { title: 'Vehicles', columns: [{ label: 'Measure' }, { label: 'Count', num: true }], rows: [['Total vehicles', n(r.vehicles)], ['Active', n(r.vehicles_active)], ['Registration due in 30 days', n(r.reg_due)], ['Insurance due in 30 days', n(r.ins_due)], ['Inspection due in 30 days', n(r.insp_due)], ['Service due (date or mileage)', n(r.v_service_due)], ['In maintenance or repair', n(r.v_maint)]],
          links: ['/assets?tab=vehicles', '/assets?tab=vehicles&status=active', '/assets?tab=vehicles&due=30', '/assets?tab=vehicles&due=30', '/assets?tab=vehicles&due=30', '/assets?tab=vehicles&due=30', '/assets?tab=vehicles&status=in_maintenance'] },
        { title: 'Equipment & assets', columns: [{ label: 'Measure' }, { label: 'Count', num: true }], rows: [['Total assets', n(r.assets)], ['Active', n(r.a_active)], ['Assigned', n(r.a_assigned)], ['Available', n(r.a_available)], ['In maintenance or repair', n(r.a_maint)], ['Out of service or retired', n(r.a_out)], ['Warranty expiring in 60 days', n(r.warranty_due)], ['Maintenance due in 30 days', n(r.a_service_due)]],
          links: ['/assets?tab=assets', '/assets?tab=assets&status=active', '/assets?tab=assets&status=assigned', '/assets?tab=assets&unassigned=1', '/assets?tab=assets&status=in_maintenance', '/assets?tab=assets&status=out_of_service', '/assets?tab=assets&due=30', '/assets?tab=assets&due=30'] },
        { title: 'Maintenance and running costs in this period', columns: [{ label: 'Group' }, { label: 'Cost', money: true }], rows: [['Vehicles', n(r.v_cost)], ['Equipment & assets', n(r.a_cost)]], totals: ['Total', r2(n(r.v_cost) + n(r.a_cost))], note: 'Maintenance records plus expenses linked to a vehicle or asset.' },
      ]
    }
    case 'cheques': {
      const c = s.cheques ?? {}
      return [{ title: 'Cheques (tracked manually; nothing is marked cleared automatically)', columns: [{ label: 'Measure' }, { label: 'Count', num: true }, { label: 'Amount', money: true }],
        rows: [['Incoming, open', n(c.in_open_n), n(c.in_open)], ['Outgoing, open', n(c.out_open_n), n(c.out_open)], ['Due this week (net in minus out)', n(c.week_n), n(c.week)], ['Due by month end', n(c.month_n), null], ['Awaiting clearance', n(c.awaiting_n), n(c.awaiting)],
          ['Past date, not banked', n(c.overdue_n), null], ['Cleared in this period', n(c.cleared_n), n(c.cleared)], ['Returned in this period', n(c.returned_n), n(c.returned)]],
        links: ['/cheques?direction=incoming', '/cheques?direction=outgoing', '/cheques', '/cheques', '/cheques?status=deposited', '/cheques?view=list', '/cheques?status=cleared', '/cheques?status=returned'] }]
    }
    default: return []
  }
}
