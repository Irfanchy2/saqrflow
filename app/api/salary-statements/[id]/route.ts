import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/auth'
import { getMe } from '@/lib/me'
import { movements, salaryAccount, statementRange } from '@/lib/salary'
import { statement } from '@/lib/salary-math'
import { brandingBytes, brandingFor } from '@/lib/sales/data'
import { renderSimplePdf } from '@/lib/sales/simple-pdf'
import { fmtMoney } from '@/lib/sales/money'
import { safePart } from '@/lib/sales/filename'
import { formatShortDate } from '@/lib/time'

export const runtime = 'nodejs'
const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Salary statement PDF for one employee and date range (?from&to; ?view=1 opens it in the browser). Salary access, or the
 *  employee's own statement in the Employee Portal; RLS keeps both within the company and the employee to their own. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const c = await getCtx()
  if (!c.can('salary.view') && (await getMe()).emp?.id !== id) return new NextResponse('Forbidden', { status: 403 })
  const a = await salaryAccount(c, id)
  if (!a) return new NextResponse('Not found', { status: 404 })
  const q = new URL(req.url).searchParams
  const moves = movements(a)
  const def = statementRange(moves, c.today)   // same default period the WhatsApp share sheet names the file with
  const from = isDay(q.get('from')) ? q.get('from')! : def.from, to = isDay(q.get('to')) ? q.get('to')! : def.to
  const st = statement(moves, from, to)
  const [b, images] = await Promise.all([brandingFor(c), brandingBytes(c)])
  const bytes = await renderSimplePdf({
    title: 'Salary statement', companyName: c.company.name, images, showHeaderFooter: b.showHeaderFooter, companyAddress: b.companyAddress, companyPhone: b.companyPhone, companyEmail: b.companyEmail,
    left: [['Employee:', a.emp.full_name], ['Employee ID:', a.emp.employee_no], ...(a.monthly !== null ? [['Monthly salary:', `AED ${fmtMoney(a.monthly)}`] as [string, string]] : [])],
    right: [['From:', formatShortDate(from)], ['To:', formatShortDate(to)], ['Printed:', formatShortDate(c.today)]],
    table: {
      cols: [{ h: 'Date', w: 1.1 }, { h: 'Description', w: 3.2 }, { h: 'Owed (AED)', w: 1.2, right: true }, { h: 'Paid (AED)', w: 1.2, right: true }, { h: 'Balance (AED)', w: 1.3, right: true }],
      rows: [['', 'Balance brought forward', '', '', fmtMoney(st.brought)],
        ...st.rows.map(r => [formatShortDate(r.date), r.ref ? `${r.label} (${r.ref})` : r.label, r.amount >= 0 ? fmtMoney(r.amount) : '', r.amount < 0 ? fmtMoney(-r.amount) : '', fmtMoney(r.balance)])],
      total: ['Salary owed at the end of the period', fmtMoney(st.closing)],
    },
    note: `Added in this period: AED ${fmtMoney(st.added)}. Paid, deducted or recovered in this period: AED ${fmtMoney(st.settled)}. A negative balance means the employee has been paid in advance.`,
  })
  const name = `Salary_statement_${safePart(a.emp.full_name)}_${from}_${to}.pdf`
  return new NextResponse(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${q.get('view') === '1' ? 'inline' : 'attachment'}; filename="${name}"` } })
}
