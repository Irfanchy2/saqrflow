import { ChevronRight } from 'lucide-react'
import { Badge, type Tone } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  uploaded: { label: 'Uploaded', tone: 'blue' }, processing: { label: 'Processing…', tone: 'blue' }, ocr_complete: { label: 'OCR complete', tone: 'blue' },
  classification_complete: { label: 'Classified', tone: 'blue' }, ready: { label: 'Ready for review', tone: 'green' }, needs_review: { label: 'Manual review required', tone: 'amber' },
  duplicate: { label: 'Possible duplicate', tone: 'red' }, filed: { label: 'Filed', tone: 'neutral' }, rejected: { label: 'Rejected', tone: 'neutral' }, failed: { label: 'Failed', tone: 'red' },
}
export const StatusPill = ({ s }: { s: string }) => <Badge tone={STATUS[s]?.tone ?? 'neutral'}>{STATUS[s]?.label ?? s}</Badge>

/** Spec bands: ≥90 high · 70–89 review recommended · <70 manual review required. */
export const band = (v: number | null | undefined) => v == null ? null : v >= 0.9 ? { label: 'High confidence', tone: 'green' as Tone } : v >= 0.7 ? { label: 'Review recommended', tone: 'amber' as Tone } : { label: 'Manual review required', tone: 'red' as Tone }
export function ConfidenceBand({ v }: { v: number | null | undefined }) { const b = band(v); return b ? <Badge tone={b.tone}>{b.label} · {Math.round(Number(v) * 100)}%</Badge> : null }

export function Confidence({ v, className }: { v: number | null | undefined; className?: string }) {
  if (v == null) return null
  const p = Math.round(Number(v) * 100)
  return <span className={cn('inline-flex items-center gap-1 text-xs font-medium tabular-nums', p >= 90 ? 'text-success' : p >= 70 ? 'text-warning' : 'text-danger', className)} title="Confidence">
    <span className="inline-block h-1.5 w-8 overflow-hidden rounded-full bg-surface-2"><span className={cn('block h-full', p >= 90 ? 'bg-success' : p >= 70 ? 'bg-warning' : 'bg-danger')} style={{ width: `${p}%` }} /></span>{p}%</span>
}

export const PathCrumbs = ({ path }: { path: string[] }) => <span className="inline-flex flex-wrap items-center gap-0.5 text-xs text-muted">
  {path.map((p, i) => <span key={i} className="inline-flex items-center gap-0.5">{i > 0 && <ChevronRight size={11} className="rtl:rotate-180" />}<span className={i === path.length - 1 ? 'font-medium text-fg' : ''}>{p}</span></span>)}</span>
