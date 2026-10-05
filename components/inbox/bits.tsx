import { ChevronRight } from 'lucide-react'
import { Badge, type Tone } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  processing: { label: 'Analysing…', tone: 'blue' }, ready: { label: 'Ready to file', tone: 'green' }, needs_review: { label: 'Manual review required', tone: 'amber' },
  duplicate: { label: 'Possible duplicate', tone: 'red' }, filed: { label: 'Filed', tone: 'neutral' }, rejected: { label: 'Rejected', tone: 'neutral' }, failed: { label: 'Failed', tone: 'red' },
}
export const StatusPill = ({ s }: { s: string }) => <Badge tone={STATUS[s]?.tone ?? 'neutral'}>{STATUS[s]?.label ?? s}</Badge>

export function Confidence({ v, className }: { v: number | null | undefined; className?: string }) {
  if (v == null) return null
  const p = Math.round(Number(v) * 100)
  return <span className={cn('inline-flex items-center gap-1 text-xs font-medium tabular-nums', p >= 80 ? 'text-success' : p >= 60 ? 'text-warning' : 'text-danger', className)} title="Confidence">
    <span className="inline-block h-1.5 w-8 overflow-hidden rounded-full bg-surface-2"><span className={cn('block h-full', p >= 80 ? 'bg-success' : p >= 60 ? 'bg-warning' : 'bg-danger')} style={{ width: `${p}%` }} /></span>{p}%</span>
}

export const PathCrumbs = ({ path }: { path: string[] }) => <span className="inline-flex flex-wrap items-center gap-0.5 text-xs text-muted">
  {path.map((p, i) => <span key={i} className="inline-flex items-center gap-0.5">{i > 0 && <ChevronRight size={11} className="rtl:rotate-180" />}<span className={i === path.length - 1 ? 'font-medium text-fg' : ''}>{p}</span></span>)}</span>
