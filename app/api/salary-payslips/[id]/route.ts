import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/auth'
import { getMe } from '@/lib/me'
import { loadPayslip, payslipPdf } from '@/lib/salary-docs'

export const runtime = 'nodejs'
/** Monthly payslip PDF (`id` = the month's salary entry). Salary access, or the employee's own payslip in the Employee Portal;
 *  RLS keeps both within the company and an employee to their own months. ?view=1 opens it in the browser to print. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const c = await getCtx()
  const own = c.can('salary.view') ? undefined : (await getMe()).emp?.id
  if (!c.can('salary.view') && !own) return new NextResponse('Forbidden', { status: 403 })
  const p = await loadPayslip(c, id, own)
  if (!p) return new NextResponse('Not found', { status: 404 })
  const bytes = await payslipPdf(c, p)
  return new NextResponse(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${new URL(req.url).searchParams.get('view') === '1' ? 'inline' : 'attachment'}; filename="${p.filename}"` } })
}
