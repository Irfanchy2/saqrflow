// Dashboard trend maths (pure, unit-tested): 12 calendar months of sales (ex VAT), collections and recorded expenses,
// and month-to-date compared with the same days of the previous month (a fair comparison early in the month).

export interface TrendMonth { key: string; label: string; sales: number; collected: number; expenses: number }
export interface Trend { months: TrendMonth[]; mtd: { sales: number; collected: number }; prevMtd: { sales: number; collected: number }; change: { sales: number | null; collected: number | null } }

const ym = (d: string) => d.slice(0, 7)
const shift = (key: string, n: number) => { const [y, m] = key.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }
const LABEL = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })

/** % change, rounded to one decimal; null when there is nothing to compare against (avoids a misleading "+100%"). */
export const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null)

export function buildTrend(today: string, invoices: { issue_date: string; total: number | string; vat_amount: number | string | null }[], payments: { paid_on: string; amount: number | string }[], expenses: { spent_on: string; amount: number | string }[] = []): Trend {
  const cur = ym(today)
  const keys = Array.from({ length: 12 }, (_, i) => shift(cur, i - 11))
  const months = new Map<string, TrendMonth>(keys.map(k => [k, { key: k, label: LABEL(k), sales: 0, collected: 0, expenses: 0 }]))
  const day = Number(today.slice(8, 10)), prev = shift(cur, -1)
  const mtd = { sales: 0, collected: 0 }, prevMtd = { sales: 0, collected: 0 }
  for (const i of invoices) {
    const v = Number(i.total) - Number(i.vat_amount ?? 0), m = months.get(ym(i.issue_date)); if (m) m.sales += v
    if (ym(i.issue_date) === cur && i.issue_date <= today) mtd.sales += v
    if (ym(i.issue_date) === prev && Number(i.issue_date.slice(8, 10)) <= day) prevMtd.sales += v
  }
  for (const p of payments) {
    const v = Number(p.amount), m = months.get(ym(p.paid_on)); if (m) m.collected += v
    if (ym(p.paid_on) === cur && p.paid_on <= today) mtd.collected += v
    if (ym(p.paid_on) === prev && Number(p.paid_on.slice(8, 10)) <= day) prevMtd.collected += v
  }
  for (const e of expenses) { const m = months.get(ym(e.spent_on)); if (m) m.expenses += Number(e.amount) }
  const r2 = (n: number) => Math.round(n * 100) / 100
  const list = [...months.values()].map(m => ({ ...m, sales: r2(m.sales), collected: r2(m.collected), expenses: r2(m.expenses) }))
  return { months: list, mtd, prevMtd, change: { sales: pctChange(mtd.sales, prevMtd.sales), collected: pctChange(mtd.collected, prevMtd.collected) } }
}

/** "Good morning" in the company's time zone. */
export function greeting(tz: string, now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(now))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
