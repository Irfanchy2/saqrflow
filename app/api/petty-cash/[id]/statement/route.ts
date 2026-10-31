import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/auth'
import { getMe } from '@/lib/me'
import { canManagePetty, walletOf } from '@/lib/petty'
import { statement, statementRange } from '@/lib/petty-math'
import { brandingBytes, brandingFor } from '@/lib/sales/data'
import { renderSimplePdf } from '@/lib/sales/simple-pdf'
import { fmtMoney } from '@/lib/sales/money'
import { safePart } from '@/lib/sales/filename'
import { formatShortDate } from '@/lib/time'

export const runtime = 'nodejs'
const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Employee Petty Cash statement PDF for one employee and period (?from&to; ?view=1 opens it in the browser). Petty cash
 *  managers and finance, or the employee's own statement in the portal; RLS keeps both inside the company and the
 *  employee to their own wallet. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const c = await getCtx()
  if (!canManagePetty(c) && !c.can('finance.view') && (await getMe()).emp?.id !== id) return new NextResponse('Forbidden', { status: 403 })
  const a = await walletOf(c, id)
  if (!a) return new NextResponse('Not found', { status: 404 })
  const q = new URL(req.url).searchParams
  const def = statementRange(a.entries, c.today)   // the same default period the WhatsApp share sheet names the file with
  const from = isDay(q.get('from')) ? q.get('from')! : def.from, to = isDay(q.get('to')) ? q.get('to')! : def.to
  const st = statement(a.entries, from, to)
  const [b, images] = await Promise.all([brandingFor(c), brandingBytes(c)])
  const bytes = await renderSimplePdf({
    title: 'Petty cash statement', companyName: c.company.name, images, showHeaderFooter: b.showHeaderFooter, companyAddress: b.companyAddress, companyPhone: b.companyPhone, companyEmail: b.companyEmail,
    left: [['Employee:', a.emp.full_name], ['Employee ID:', a.emp.employee_no], ['Reimbursement due:', `AED ${fmtMoney(st.reimbursementDue)}`]],
    right: [['From:', formatShortDate(from)], ['To:', formatShortDate(to)], ['Printed:', formatShortDate(c.today)]],
    table: {
      cols: [{ h: 'Date', w: 1.05 }, { h: 'Type', w: 1.9 }, { h: 'Description', w: 2.6 }, { h: 'In (AED)', w: 1.05, right: true }, { h: 'Out (AED)', w: 1.05, right: true }, { h: 'Balance (AED)', w: 1.2, right: true }],
      rows: [['', 'Opening balance', '', '', '', fmtMoney(st.opening)],
        ...st.rows.map(r => [formatShortDate(r.date), cut(r.label, 30), cut(r.reference ? `${r.detail} (${r.reference})` : r.detail, 44), r.in ? fmtMoney(r.in) : '', r.out ? fmtMoney(r.out) : '', fmtMoney(r.balance)])],
      total: ['Closing petty cash balance', fmtMoney(st.closing)],
    },
    note: `In this period: petty cash received AED ${fmtMoney(st.received)}; approved expenses settled AED ${fmtMoney(st.settled)}; petty cash returned AED ${fmtMoney(st.returned)}; authorized adjustments AED ${fmtMoney(st.adjustments)}.`
      + (st.reimbursements.length ? ` Reimbursements (employee's own money, not part of the petty cash balance): ${st.reimbursements.map(r => `${formatShortDate(r.date)} ${r.label.toLowerCase()} AED ${fmtMoney(Math.abs(r.amount))}`).join('; ')}.` : '')
      + ' Petty cash is company money for business expenses. It is not salary and is not deducted from salary.',
  })
  const name = `Petty_cash_statement_${safePart(a.emp.full_name)}_${from}_${to}.pdf`
  return new NextResponse(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${q.get('view') === '1' ? 'inline' : 'attachment'}; filename="${name}"` } })
}
