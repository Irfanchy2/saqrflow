import type { Cell, Column } from './sections'
const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** One cell format for screen, CSV and PDF: money "1,250.00", counts "1,250", percentages "47.2%", empty figures "—". */
export function fmtCell(v: Cell, col: Column): string {
  if (v === null || v === undefined || v === '') return col.money || col.num || col.pct ? '—' : ''
  if (typeof v === 'number') return col.money ? money.format(v) : col.pct ? `${v}%` : v.toLocaleString('en-US')
  return v
}
