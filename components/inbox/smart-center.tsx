import Link from 'next/link'
import { ArrowRight, Inbox } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Card, CardHeader } from '@/components/ui/primitives'
import { addDays, zonedToUtc } from '@/lib/time'
import { cn } from '@/lib/utils'

/** Dashboard panel: today's Smart Inbox activity, what waits for review, and the 30-day automatic classification rate. */
export async function SmartInboxPanel({ c }: { c: Ctx }) {
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
  const rows2: [string, number | string, string, boolean?][] = [
    ['Uploaded today', today.length, '/inbox'],
    ['Waiting for your review', all.filter(r => r.status === 'needs_review').length, '/inbox?tab=needs_review', true],
    ['Not recognised', all.filter(r => r.doc_type === 'unknown' && !['filed', 'rejected'].includes(r.status)).length, '/inbox?tab=needs_review', true],
    ['Possible duplicates', all.filter(r => r.status === 'duplicate').length, '/inbox?tab=duplicate', true],
    ['Expiring within 60 days', expiring ?? 0, '/vault?status=expiring'],
  ]
  return <Card><CardHeader title="Smart Inbox" sub={rate == null ? 'Drop documents in; you confirm before anything is filed' : `${rate}% classified automatically in the last 30 days`}
    action={<Link href="/inbox" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Inbox size={13} aria-hidden />Open<ArrowRight size={12} className="rtl:rotate-180" aria-hidden /></Link>} />
    <ul className="divide-y divide-border">{rows2.map(([l, v, h, act]) => <li key={l}><Link href={h} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-surface-2/50">
      <span className="truncate text-muted">{l}</span><span className={cn('font-semibold tabular-nums', !v ? 'text-muted/60' : act ? 'text-warning' : 'text-fg')}>{v}</span></Link></li>)}</ul></Card>
}
