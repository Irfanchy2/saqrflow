import { NextResponse, type NextRequest } from 'next/server'
import { logLinkEvent, resolveLink } from '@/lib/portal'
import { brandingBytes, brandingFor } from '@/lib/sales/data'
import { buildLedger } from '@/lib/ledger'
import { renderStatementPdf } from '@/lib/sales/statement-pdf'
import { safePart } from '@/lib/sales/filename'

export const runtime = 'nodejs'
/** Statement of account for the portal's customer (all open and settled invoices, payments and credit notes). */
export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await resolveLink(token, 'customer_portal')
  if (!r || !r.link.customer_id) return new NextResponse('Not found', { status: 404 })
  const { data: cu } = await r.admin.from('customers').select('name,address,trn,phone,email,contact_person').eq('id', r.link.customer_id).eq('company_id', r.company.id).maybeSingle()
  if (!cu) return new NextResponse('Not found', { status: 404 })
  const [ledger, b, images] = await Promise.all([buildLedger(r.ctx, r.link.customer_id, {}), brandingFor(r.ctx), brandingBytes(r.ctx)])
  const bytes = await renderStatementPdf(cu, ledger, { companyName: r.company.name, images, showHeaderFooter: b.showHeaderFooter, companyTrn: b.companyTrn, bankDetails: b.bankDetails, from: undefined, to: undefined, today: r.ctx.today, companyAddress: b.companyAddress, companyPhone: b.companyPhone, companyEmail: b.companyEmail })
  await logLinkEvent(r, 'downloaded', 'statement')
  return new NextResponse(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', 'Content-Disposition': `inline; filename="Statement_${safePart(cu.name) || 'customer'}_${r.ctx.today}.pdf"` } })
}
