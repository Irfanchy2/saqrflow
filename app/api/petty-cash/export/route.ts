import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { toCsv } from '@/lib/csv'
import { ENTRY_COLS, canManagePetty } from '@/lib/petty'
import { KIND, kindLabel, methodLabel, type PettyEntry } from '@/lib/petty-math'

const UUID = /^[0-9a-f-]{36}$/i
const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Petty cash transactions as CSV (filters: employee, project, kind, from, to). Data export plus petty cash or finance
 *  access; rows come from the caller's own RLS-scoped session. */
export async function GET(req: NextRequest) {
  const c = await getCtx()
  if (!c.can('data.export') || (!canManagePetty(c) && !c.can('finance.view'))) return new NextResponse('You do not have permission to export this list.', { status: 403 })
  const p = req.nextUrl.searchParams
  let q = c.supabase.from('petty_cash_entries').select(`${ENTRY_COLS},employee:employees(full_name,employee_no)`).order('entry_date').order('created_at').limit(50000)
  const emp = p.get('employee'), proj = p.get('project'), kind = p.get('kind'), from = p.get('from'), to = p.get('to')
  if (emp && UUID.test(emp)) q = q.eq('employee_id', emp)
  if (proj && UUID.test(proj)) q = q.eq('project_id', proj)
  if (kind && kind in KIND) q = q.or(`kind.eq.${kind},reverses_kind.eq.${kind}`)
  if (isDay(from)) q = q.gte('entry_date', from!); if (isDay(to)) q = q.lte('entry_date', to!)
  const { data, error } = await q
  if (error) return new NextResponse('The export could not be prepared.', { status: 500 })
  const rows = (data ?? []).map((e: any) => [e.entry_date, e.employee?.full_name ?? '', e.employee?.employee_no ?? '', kindLabel(e as PettyEntry), e.book === 'wallet' ? 'Petty cash' : 'Reimbursement',
    Number(e.amount).toFixed(2), e.description, e.reference ?? '', e.project?.name ?? '', methodLabel(e.method), e.bank?.name ?? '', e.creator?.full_name ?? '', e.id])
  const body = toCsv(['Date', 'Employee', 'Employee ID', 'Type', 'Book', 'Amount (AED)', 'Description', 'Reference', 'Project', 'Method', 'Company account', 'Recorded by', 'Transaction ID'], rows)
  return new NextResponse(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="averiqo-petty-cash-${c.today}.csv"`, 'Cache-Control': 'no-store' } })
}
