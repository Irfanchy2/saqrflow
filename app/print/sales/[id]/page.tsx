import { notFound, redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { brandingFor, loadSalesDoc } from '@/lib/sales/data'
import { DOC_META } from '@/lib/sales/docs'
import { SalesPaper } from '@/components/sales/paper'
import { PrintButton } from '@/components/print-button'

export const dynamic = 'force-dynamic'

/** Bare A4 page (outside the app shell) — browser print keeps Arabic text shaping and exact template layout. */
export default async function PrintSales({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const d = await loadSalesDoc(c, id); if (!d) notFound()
  const branding = await brandingFor(c)
  return <div className="print-sheet min-h-screen bg-neutral-200 py-8 print:py-0">
    <title>{`${DOC_META[d.doc.doc_type].label} ${d.doc.number}`}</title>
    <div className="no-print mx-auto mb-4 flex max-w-[794px] items-center justify-between px-2 text-sm text-neutral-700">
      <span>{DOC_META[d.doc.doc_type].label} {d.doc.number} — A4, no margins. Turn on “Background graphics” for the shaded boxes.</span>
      <PrintButton auto={(await searchParams).auto === '1'} />
    </div>
    <SalesPaper doc={d.doc} items={d.items} branding={branding} paid={d.paid} className="shadow-xl print:shadow-none" />
  </div>
}
