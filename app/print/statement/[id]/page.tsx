import { notFound, redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { brandingFor } from '@/lib/sales/data'
import { buildLedger } from '@/lib/ledger'
import { StatementPaper } from '@/components/sales/statement'
import { PrintButton } from '@/components/print-button'
import { flat } from '@/lib/queries'
import { statementParams } from '@/lib/statement-params'
import { safePart } from '@/lib/sales/filename'

export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {}
  const c = await getCtx()
  const { data } = await c.supabase.from('customers').select('name').eq('id', id).maybeSingle()
  return data ? { title: { absolute: `Statement_${safePart(data.name)}_${c.today}` } } : {}
}
export default async function PrintStatement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const sp = await flat(searchParams), f = statementParams(sp)
  const { data: cu } = await c.supabase.from('customers').select('name,address,trn,phone,email,contact_person').eq('id', id).maybeSingle()
  if (!cu) notFound()
  const [ledger, branding] = await Promise.all([buildLedger(c, id, f), brandingFor(c)])
  return <div className="print-sheet min-h-screen bg-neutral-200 py-8 print:py-0">
    <div className="no-print mx-auto mb-4 flex max-w-[794px] items-center justify-between px-2 text-sm text-neutral-700"><span>Statement of account: {cu.name}. A4, no margins; turn on “Background graphics”.</span><PrintButton auto={sp.auto === '1'} /></div>
    <StatementPaper customer={cu} ledger={ledger} branding={branding} from={f.from} to={f.to} today={c.today} className="shadow-pop print:shadow-none" />
  </div>
}
