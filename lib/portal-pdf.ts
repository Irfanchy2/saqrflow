import 'server-only'
import { NextResponse } from 'next/server'
import { buildSalesPdf } from '@/lib/sales/build'
import { logLinkEvent, type ResolvedLink } from '@/lib/portal'

const NF = () => new NextResponse('Not found', { status: 404 })

/** PDF of one issued document, only if it belongs to the link (customer / supplier / the quotation itself). */
export async function linkPdf(r: ResolvedLink, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NF()
  const { data: d } = await r.admin.from('invoices').select('id,doc_type,status,customer_id,supplier_id,deleted_at,number').eq('id', id).eq('company_id', r.company.id).maybeSingle()
  if (!d || d.deleted_at || ['draft', 'cancelled'].includes(d.status)) return NF()
  const ok = r.link.kind === 'quote_response' ? d.id === r.link.invoice_id
    : r.link.kind === 'customer_portal' ? d.customer_id === r.link.customer_id && ['quotation', 'invoice', 'credit_note', 'delivery_note'].includes(d.doc_type)
    : r.link.kind === 'supplier_portal' ? d.supplier_id === r.link.supplier_id && d.doc_type === 'purchase_order' : false
  if (!ok) return NF()
  const built = await buildSalesPdf(r.ctx, id)
  if (!built) return NF()
  await logLinkEvent(r, 'downloaded', d.number)
  await r.admin.from('sales_doc_events').insert({ company_id: r.company.id, invoice_id: id, event: 'downloaded', detail: 'through a secure link', user_id: null })
  return new NextResponse(built.bytes as BodyInit, { headers: {
    'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex',
    'Content-Disposition': `inline; filename="${built.name.replace(/[^\w .()-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(built.name)}`,
  } })
}
