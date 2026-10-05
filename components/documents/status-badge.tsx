import { Badge, type Tone } from '@/components/ui/primitives'
import { effectiveStatus, STATUS_LABEL, daysRemaining, type DocStatus } from '@/lib/documents'
const TONE: Record<DocStatus, Tone> = { valid: 'green', expiring_soon: 'amber', expired: 'red', no_expiry: 'neutral', renewal_in_progress: 'blue', cancelled: 'neutral', archived: 'neutral' }
export function StatusBadge({ doc, today }: { doc: { expiry_date?: string | null; status?: string | null }; today: string }) {
  const s = effectiveStatus(doc, today), d = daysRemaining(doc.expiry_date, today)
  return <Badge tone={TONE[s]}>{STATUS_LABEL[s]}{d !== null && s !== 'cancelled' && <span className="opacity-70">· {d < 0 ? `${-d}d ago` : `${d}d`}</span>}</Badge>
}
