import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { buildSalesPdf } from '@/lib/sales/build'

export const runtime = 'nodejs'
/** Downloads the quotation / invoice / delivery note as an A4 PDF (RLS: finance.view within the company). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const c = await getCtx()
  if (!c.can('finance.view')) return new NextResponse('Forbidden', { status: 403 })
  const built = await buildSalesPdf(c, id)
  if (!built) return new NextResponse('Not found', { status: 404 })
  const inline = req.nextUrl.searchParams.get('inline') === '1'
  await c.supabase.from('sales_doc_events').insert({ company_id: c.company.id, invoice_id: id, event: 'downloaded', user_id: c.userId })
  return new NextResponse(built.bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${built.name.replace(/[^\w .()-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(built.name)}`,
    },
  })
}
