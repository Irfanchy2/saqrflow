import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/auth'
import { SendError, resolveMessage } from '@/lib/whatsapp/outbox'
import { getMe } from '@/lib/me'

export const runtime = 'nodejs'
/** Salary payment receipt PDF for one salary payment (?view=1 opens it in the browser to print) (salary.view, or the employee's own payslip in the Employee Portal; RLS keeps
 *  it within the company and an employee to their own payments). Same PDF WhatsApp attaches. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const c = await getCtx()
  const own = c.can('salary.view') ? null : (await getMe()).emp?.id ?? null
  if (!c.can('salary.view') && !own) return new NextResponse('Forbidden', { status: 403 })
  try {
    const { pdf } = await resolveMessage(c, 'payslip', id, own ? { ownEmployeeId: own } : undefined)
    const { bytes, filename } = await pdf!()
    return new NextResponse(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${new URL(req.url).searchParams.get('view') === '1' ? 'inline' : 'attachment'}; filename="${filename}"` } })
  } catch (e) {
    if (e instanceof SendError) return new NextResponse('Not found', { status: 404 })
    throw e
  }
}
