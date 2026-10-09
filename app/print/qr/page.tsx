import { notFound, redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { baseUrl, qrSvg } from '@/lib/qr'
import { PrintButton } from '@/components/print-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: { absolute: 'QR labels' } }

/**
 * Printable QR labels for vehicles, equipment and projects. The code opens the record in Averiqo; scanning still requires
 * signing in (and the permission to see the record), so a label on a vehicle reveals nothing to strangers.
 */
export default async function QrLabels({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams)
  const type = sp.type === 'project' ? 'project' : sp.type === 'asset' ? 'asset' : null
  if (!type) notFound()
  const ids = (sp.ids ?? '').split(',').filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200)
  let q = type === 'asset' ? c.supabase.from('assets').select('id,name,kind,plate_or_serial,make,model').is('archived_at', null) : c.supabase.from('projects').select('id,name,code,location')
  if (ids.length) q = q.in('id', ids)
  else if (type === 'asset' && sp.kind === 'vehicle') q = q.eq('kind', 'vehicle')
  else if (type === 'asset' && sp.kind === 'equipment') q = q.neq('kind', 'vehicle')
  const { data: rows } = await q.order('name').limit(200)
  if (!rows?.length) notFound()
  const base = await baseUrl()
  const labels = await Promise.all(rows.map(async (r: any) => {
    const url = `${base}/${type === 'asset' ? 'assets' : 'projects'}/${r.id}`
    return { id: r.id, svg: await qrSvg(url), title: r.name, sub: type === 'asset' ? [r.plate_or_serial, [r.make, r.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : [r.code, r.location].filter(Boolean).join(' · ') }
  }))
  return <div className="print-sheet min-h-screen bg-neutral-100 py-6 print:bg-white print:py-0">
    <div className="no-print mx-auto mb-4 flex max-w-[794px] items-center justify-between gap-3 px-3 text-sm text-neutral-700"><span>{labels.length} label{labels.length === 1 ? '' : 's'} · A4, 3 per row. Scanning opens the record after sign-in.</span><PrintButton /></div>
    <div className="mx-auto grid max-w-[794px] grid-cols-2 gap-3 bg-white p-4 text-neutral-900 sm:grid-cols-3 print:grid-cols-3 print:gap-2 print:p-0">
      {labels.map(l => <div key={l.id} className="flex break-inside-avoid flex-col items-center rounded-md border border-neutral-300 p-3 text-center print:rounded-none">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{c.company.name}</div>
        <div className="my-1.5 w-[150px] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: l.svg }} />
        <div className="text-sm font-semibold leading-tight">{l.title}</div>
        {l.sub && <div className="mt-0.5 text-xs text-neutral-600">{l.sub}</div>}
      </div>)}
    </div>
  </div>
}
