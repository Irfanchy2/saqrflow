import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/auth'
import { SendError, resolveMessage } from '@/lib/whatsapp/outbox'

export const runtime = 'nodejs'
/** Salary payslip PDF for one salary payment (salary.view; RLS keeps it within the company). Same PDF WhatsApp attaches. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const c = await getCtx()
  if (!c.can('salary.view')) return new NextResponse('Forbidden', { status: 403 })
  try {
    const { pdf } = await resolveMessage(c, 'payslip', id)
    const { bytes, filename } = await pdf!()
    return new NextResponse(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="${filename}"` } })
  } catch (e) {
    if (e instanceof SendError) return new NextResponse('Not found', { status: 404 })
    throw e
  }
}
