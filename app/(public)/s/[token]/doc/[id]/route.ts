import { NextResponse, type NextRequest } from 'next/server'
import { resolveLink } from '@/lib/portal'
import { linkPdf } from '@/lib/portal-pdf'

export const runtime = 'nodejs'
export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const r = await resolveLink(token, 'supplier_portal')
  if (!r) return new NextResponse('Not found', { status: 404 })
  return linkPdf(r, id)
}
