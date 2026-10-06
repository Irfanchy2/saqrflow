import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { brandingBytes, brandingFor } from '@/lib/sales/data'
import { buildLedger } from '@/lib/ledger'
import { renderStatementPdf } from '@/lib/sales/statement-pdf'
import { statementParams } from '@/lib/statement-params'
import { safePart } from '@/lib/sales/filename'

export const runtime = 'nodejs'
/** Customer statement PDF (RLS: finance.view within the company). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const c = await getCtx()
  if (!c.can('finance.view')) return new NextResponse('Forbidden', { status: 403 })
  const f = statementParams(Object.fromEntries(req.nextUrl.searchParams))
  const { data: cu } = await c.supabase.from('customers').select('name,address,trn,phone,email,contact_person').eq('id', id).maybeSingle()
  if (!cu) return new NextResponse('Not found', { status: 404 })
  const [ledger, b, images] = await Promise.all([buildLedger(c, id, f), brandingFor(c), brandingBytes(c)])
  const bytes = await renderStatementPdf(cu, ledger, { companyName: c.company.name, images, showHeaderFooter: b.showHeaderFooter, companyTrn: b.companyTrn, bankDetails: b.bankDetails, from: f.from, to: f.to, today: c.today, companyAddress: b.companyAddress, companyPhone: b.companyPhone, companyEmail: b.companyEmail })
  const name = `Statement_${safePart(cu.name) || 'customer'}_${f.to ?? c.today}.pdf`
  return new NextResponse(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="${name}"` } })
}
