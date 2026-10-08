import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { allowedSections, loadReport } from '@/lib/reports/load'
import { SECTIONS, sectionTables, type SectionKey } from '@/lib/reports/sections'
import { renderReportPdf } from '@/lib/reports/pdf'
import { fmtCell } from '@/lib/reports/format'
import { toCsv } from '@/lib/csv'
import { writeXlsx } from '@/lib/xlsx'

/**
 * Report export for the current filters (?period / from / to): CSV, Excel or PDF. Same tables as the screen.
 * Needs data.export plus the section's own permission (finance sections: finance.view). Every export is audit-logged.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  const c = await getCtx()
  if (!c.can('data.export') || !allowedSections(c).includes(section as SectionKey) || section === 'overview') return new NextResponse('You do not have permission to export this report.', { status: 403 })
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const { period, data } = await loadReport(c, sp)
  const tables = sectionTables(section as SectionKey, data, c.today)
  const title = SECTIONS.find(([k]) => k === section)![1]
  const generated = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: c.company.timezone }).format(new Date())
  const format = sp.format === 'xlsx' ? 'xlsx' : sp.format === 'pdf' ? 'pdf' : 'csv'
  try { await createAdminClient().from('audit_logs').insert({ company_id: c.company.id, user_id: c.userId, action: 'EXPORT', table_name: `report:${section}`, changes: { format, from: period.from, to: period.to } }) } catch {}
  const name = `${c.company.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'company'}_${title.replace(/[^A-Za-z0-9]+/g, '-')}_${period.from}_${period.to}`
  if (format === 'pdf') {
    const bytes = await renderReportPdf({ company: c.company.name, title, period: period.label, generated, tables })
    return new NextResponse(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"`, 'Cache-Control': 'no-store' } })
  }
  // spreadsheet: report context rows, then each table with its title, header, rows and totals (numbers stay numeric)
  const meta: unknown[][] = [['Company', c.company.name], ['Report', title], ['Period', `${period.from} to ${period.to}`], ['Generated', generated], ['Software', 'Averiqo']]
  const body: unknown[][] = [...meta]
  for (const t of tables) {
    body.push([], [t.title + (t.columns.some(x => x.money) ? ' (AED)' : '')], t.columns.map(x => x.label))
    for (const r of t.rows) body.push(r.map((v, j) => (typeof v === 'number' || v === null ? v : fmtCell(v, t.columns[j]))))
    if (t.totals) body.push(t.totals)
    if (t.note) body.push([t.note])
  }
  const [head, ...rest] = body as unknown[][]
  const out = format === 'xlsx' ? writeXlsx(title, head.map(String), rest) : toCsv(head.map(String), rest)
  return new NextResponse(out as BodyInit, { headers: { 'Content-Type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.${format}"`, 'Cache-Control': 'no-store' } })
}
