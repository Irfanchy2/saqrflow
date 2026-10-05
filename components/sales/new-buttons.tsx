'use client'
import { useTransition } from 'react'
import { Loader2, Receipt, ScrollText, Truck } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { toast } from '@/components/ui/toast'
import { newSalesDoc } from '@/app/actions/sales'
import type { SalesType } from '@/lib/sales/docs'

const DEF: { t: SalesType; label: string; icon: typeof Receipt }[] = [
  { t: 'quotation', label: 'Quotation', icon: ScrollText }, { t: 'invoice', label: 'Tax invoice', icon: Receipt }, { t: 'delivery_note', label: 'Delivery note', icon: Truck },
]
/** "New quotation / invoice / delivery note" — creates a numbered draft and opens the builder. */
export function NewSalesButtons({ customerId, projectId, only, size = 'md' }: { customerId?: string; projectId?: string; only?: SalesType[]; size?: 'sm' | 'md' }) {
  const [pending, start] = useTransition()
  return <>{DEF.filter(d => !only || only.includes(d.t)).map((d, i) => <Button key={d.t} size={size} variant={i === 0 ? 'primary' : 'secondary'} disabled={pending}
    onClick={() => start(async () => { const r = await newSalesDoc(d.t, { customerId, projectId }); if (r?.error) toast(r.error, 'error') })}>
    {pending ? <Loader2 size={14} className="animate-spin" /> : <d.icon size={14} />}New {d.label.toLowerCase()}</Button>)}</>
}
