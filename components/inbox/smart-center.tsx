import Link from 'next/link'
import { ArrowRight, Inbox } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Card, CardHeader } from '@/components/ui/primitives'
import { addDays, zonedToUtc } from '@/lib/time'

/** Dashboard widget: today's Smart Inbox activity + 30-day classification success rate. */
export async function SmartDocumentCenter({ c }: { c: Ctx }) {
  const since30 = zonedToUtc(addDays(c.today, -30), '00:00', c.company.timezone).toISOString()
  const startToday = zonedToUtc(c.today, '00:00', c.company.timezone).toISOString()
  const [{ data: rows }, { count: expiring }] = await Promise.all([
    c.supabase.from('document_inbox').select('status,doc_type,confidence,created_at').gte('created_at', since30).limit(5000),
    c.supabase.from('documents').select('id', { count: 'exact', head: true }).is('deleted_at', null).gte('expiry_date', c.today).lte('expiry_date', addDays(c.today, 60)),
  ])
  const all = rows ?? [], today = all.filter(r => r.created_at >= startToday)
  const auto = (r: { status: string; confidence: number | null; doc_type: string | null }) => r.doc_type && r.doc_type !== 'unknown' && Number(r.confidence ?? 0) >= 0.8 && r.status !== 'failed'
  const processed = all.filter(r => r.status !== 'processing')
  const rate = processed.length ? Math.round(processed.filter(auto).length / processed.length * 100) : null
  const tiles: [string, number | string, string][] = [
    ['Uploaded today', today.length, '/inbox'],
    ['Auto-classified today', today.filter(auto).length, '/inbox?tab=ready'],
    ['Waiting for review', all.filter(r => r.status === 'needs_review').length, '/inbox?tab=needs_review'],
    ['Unknown documents', all.filter(r => r.doc_type === 'unknown' && !['filed', 'rejected'].includes(r.status)).length, '/inbox?tab=needs_review'],
    ['Possible duplicates', all.filter(r => r.status === 'duplicate').length, '/inbox?tab=duplicate'],
    ['Expiring ≤ 60 days', expiring ?? 0, '/documents?status=expiring'],
    ['AI success rate (30d)', rate == null ? '—' : `${rate}%`, '/inbox'],
  ]
  return <Card className="mb-5"><CardHeader title="Smart Document Center" sub="Drop documents into the Smart Inbox — SaqrFlow sorts them for you"
    action={<Link href="/inbox" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Inbox size={14} />Open inbox<ArrowRight size={13} className="rtl:rotate-180" /></Link>} />
    <div className="grid grid-cols-2 divide-border sm:grid-cols-4 lg:grid-cols-7 lg:divide-x rtl:divide-x-reverse">{tiles.map(([l, v, h]) => <Link key={l} href={h} className="px-4 py-3 hover:bg-surface-2/60"><div className="text-xs text-muted">{l}</div><div className="mt-1 text-xl font-semibold tabular-nums">{v}</div></Link>)}</div></Card>
}
