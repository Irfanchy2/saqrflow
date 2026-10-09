import { NextResponse, type NextRequest } from 'next/server'
import { resolveLink } from '@/lib/portal'
import { linkPdf } from '@/lib/portal-pdf'

export const runtime = 'nodejs'
export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await resolveLink(token, 'quote_response')
  if (!r || !r.link.invoice_id) return new NextResponse('Not found', { status: 404 })
  return linkPdf(r, r.link.invoice_id)
}
