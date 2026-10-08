import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, History } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { brandingFor } from '@/lib/sales/data'
import { DOC_META, type SalesType } from '@/lib/sales/docs'
import { SalesPaper } from '@/components/sales/paper'
import { FitPaper } from '@/components/sales/preview'
import { Alert, Badge, Card, CardHeader } from '@/components/ui/primitives'

export const metadata = { title: 'Previous revision' }

/** Read-only view of a previous revision, rendered with the same A4 paper as the editor and print view. */
export default async function RevisionPage({ params }: { params: Promise<{ id: string; rev: string }> }) {
  const { id, rev } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{1,4}$/.test(rev)) notFound()
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const [{ data: r }, { data: cur }, branding] = await Promise.all([
    c.supabase.from('sales_doc_revisions').select('revision,snapshot,changes,created_at,created_by').eq('invoice_id', id).eq('revision', Number(rev)).maybeSingle(),
    c.supabase.from('invoices').select('number,doc_type,revision').eq('id', id).maybeSingle(),
    brandingFor(c),
  ])
  if (!r || !cur) notFound()
  const { data: who } = r.created_by ? await c.supabase.from('profiles').select('full_name').eq('id', r.created_by).maybeSingle() : { data: null }
  const snap = r.snapshot as { doc: Record<string, any>; items: any[] }
  const doc = { ...snap.doc, doc_type: cur.doc_type as SalesType, revision: r.revision, terms: snap.doc.terms ?? [], payment_terms: snap.doc.payment_terms ?? [], vat_rate: Number(snap.doc.vat_rate ?? 5) }
  return <>
    <Link href={`/invoices/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Back to current version (Rev.{cur.revision})</Link>
    <div className="grid gap-5 lg:grid-cols-[minmax(300px,380px)_1fr]">
      <div className="flex flex-col gap-4">
        <Alert tone="amber">You are viewing <b>revision {r.revision}</b> of {DOC_META[cur.doc_type as SalesType].label} {cur.number}. It is read-only.</Alert>
        <Card><CardHeader title={`What changed after Rev.${r.revision}`} action={<History size={15} className="text-muted" aria-hidden />} />
          <p className="px-4 pt-3 text-xs text-muted">Replaced {new Date(r.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, dateStyle: 'medium', timeStyle: 'short' })} by {who?.full_name ?? 'someone'}</p>
          <ul className="list-disc space-y-1 px-8 py-3 text-sm">{(r.changes ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></Card>
        <Badge tone="neutral">Rev.{r.revision} → Rev.{r.revision + 1}</Badge>
      </div>
      <div className="min-w-0 rounded-xl bg-surface-2 p-3 sm:p-5"><FitPaper><SalesPaper doc={doc as any} items={snap.items.map(i => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price) }))} branding={branding} /></FitPaper></div>
    </div>
  </>
}
