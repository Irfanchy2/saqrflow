import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { toCsv } from '@/lib/csv'
import { writeXlsxBook } from '@/lib/xlsx'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkExport, reviewSheets } from '@/lib/expenses/tally'
import { loadExportRows, loadTallySettings, readFilters } from '@/lib/expenses/export-data'

/**
 * Review copy of an export (CSV or Excel): the expenses with their export status, the ledger lines as Tally would book
 * them, and the validation report. It does not mark anything as exported.
 */
export async function GET(req: NextRequest) {
  const c = await getCtx().catch(() => null)
  if (!c) return new NextResponse('Your session has expired. Sign in again.', { status: 401 })
  if (!c.can('finance.view') || !c.can('data.export')) return new NextResponse('You do not have permission to export expenses.', { status: 403 })
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const f = readFilters(sp)
  const [rows, s] = await Promise.all([loadExportRows(c, f, 20000), loadTallySettings(c)])
  const sh = reviewSheets(checkExport(rows, s), s)
  try { await createAdminClient().from('audit_logs').insert({ company_id: c.company.id, user_id: c.userId, action: 'EXPORT', table_name: 'project_expenses', changes: { review: sp.format === 'xlsx' ? 'xlsx' : 'csv', rows: rows.length, filters: f } }) } catch {}
  const xlsx = sp.format === 'xlsx', name = `averiqo-expenses-review-${c.today}.${xlsx ? 'xlsx' : 'csv'}`
  const body = xlsx ? writeXlsxBook([sh.expenses, sh.ledger, sh.validation]) : toCsv(sh.expenses.headers, sh.expenses.rows)
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } })
}
