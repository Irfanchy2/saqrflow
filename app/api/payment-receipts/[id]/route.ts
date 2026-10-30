import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/auth'
import { SendError, resolveMessage } from '@/lib/whatsapp/outbox'

export const runtime = 'nodejs'
/** Customer payment receipt PDF for one payment (?view=1 opens it in the browser). finance.view within the company (RLS).
 *  The same receipt WhatsApp Business attaches, so free sharing and Business send the identical document. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const c = await getCtx()
  if (!c.can('finance.view')) return new NextResponse('Forbidden', { status: 403 })
  try {
    const { pdf } = await resolveMessage(c, 'receipt', id)
    const { bytes, filename } = await pdf!()
    return new NextResponse(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${new URL(req.url).searchParams.get('view') === '1' ? 'inline' : 'attachment'}; filename="${filename}"` } })
  } catch (e) {
    if (e instanceof SendError) return new NextResponse('Not found', { status: 404 })
    throw e
  }
}
