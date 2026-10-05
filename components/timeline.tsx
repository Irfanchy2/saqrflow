import Link from 'next/link'
import { EmptyState } from '@/components/ui/primitives'
import type { TimelineEvent } from '@/lib/timeline'
import { cn } from '@/lib/utils'

const DOT: Record<TimelineEvent['kind'], string> = { issued: 'bg-muted', uploaded: 'bg-primary', version: 'bg-primary/60', renewed: 'bg-success', reminder: 'bg-warning' }
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <EmptyState title="No document history yet" />
  return <ol className="relative ms-6 border-s border-border py-2">{events.map((e, i) => <li key={i} className="mb-4 ms-4 last:mb-0">
    <span className={cn('absolute -start-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface', DOT[e.kind])} />
    <time className="text-xs tabular-nums text-muted">{e.date}</time>
    <div className="text-sm">{e.href ? <Link href={e.href} className="font-medium hover:text-primary">{e.title}</Link> : <span className="font-medium">{e.title}</span>}{e.detail && <span className="text-muted"> · {e.detail}</span>}</div></li>)}</ol>
}
