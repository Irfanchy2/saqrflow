'use client'
import { useRef, useTransition } from 'react'
import { Loader2, Receipt, ScrollText, Truck } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { toast } from '@/components/ui/toast'
import { newSalesDoc } from '@/app/actions/sales'
import type { SalesType } from '@/lib/sales/docs'

const DEF: { t: SalesType; label: string; icon: typeof Receipt }[] = [
  { t: 'quotation', label: 'Quotation', icon: ScrollText }, { t: 'invoice', label: 'Tax invoice', icon: Receipt }, { t: 'delivery_note', label: 'Delivery note', icon: Truck },
]
/** "New quotation / invoice / delivery note" — creates a numbered draft and opens the builder. */
export function NewSalesButtons({ customerId, projectId, leadId, siteVisitId, only, size = 'md', variant }: { customerId?: string; projectId?: string; leadId?: string; siteVisitId?: string; only?: SalesType[]; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' }) {
  const [pending, start] = useTransition()
  const tokens = useRef<Record<string, string>>({})     // a double click sends the same token → only one draft is created
  return <>{DEF.filter(d => !only || only.includes(d.t)).map((d, i) => <Button key={d.t} size={size} variant={variant ?? (i === 0 ? 'primary' : 'secondary')} disabled={pending}
    onClick={() => start(async () => { const r = await newSalesDoc(d.t, { customerId, projectId, leadId, siteVisitId, token: (tokens.current[d.t] ??= crypto.randomUUID()) }); if (r?.error) toast(r.error, 'error') })}>
    {pending ? <Loader2 size={14} className="animate-spin" /> : <d.icon size={14} />}New {d.label.toLowerCase()}</Button>)}</>
}
