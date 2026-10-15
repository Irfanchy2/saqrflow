'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { ChevronDown, Loader2, Plus, Receipt, ScrollText, Truck } from '@/components/icons'
import { Button } from '@/components/ui/primitives'
import { toast } from '@/components/ui/toast'
import { newSalesDoc } from '@/app/actions/sales'
import type { SalesType } from '@/lib/sales/docs'

const DEF: { t: SalesType; label: string; icon: typeof Receipt }[] = [
  { t: 'quotation', label: 'Quotation', icon: ScrollText }, { t: 'invoice', label: 'Tax invoice', icon: Receipt }, { t: 'delivery_note', label: 'Delivery note', icon: Truck },
]
/**
 * "New quotation / invoice / delivery note" — creates a numbered draft and opens the builder.
 * On phones only the first button stays; the others move into a small menu so the page header keeps to one row.
 */
export function NewSalesButtons({ customerId, projectId, leadId, siteVisitId, only, size = 'md', variant }: { customerId?: string; projectId?: string; leadId?: string; siteVisitId?: string; only?: SalesType[]; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' }) {
  const [pending, start] = useTransition(), [open, setOpen] = useState(false)
  const tokens = useRef<Record<string, string>>({})     // a double click sends the same token → only one draft is created
  const box = useRef<HTMLDivElement>(null)
  const defs = DEF.filter(d => !only || only.includes(d.t)), rest = defs.slice(1)
  const make = (t: SalesType) => start(async () => { const r = await newSalesDoc(t, { customerId, projectId, leadId, siteVisitId, token: (tokens.current[t] ??= crypto.randomUUID()) }); if (r?.error) toast(r.error, 'error') })
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus() } }
    addEventListener('pointerdown', out); addEventListener('keydown', key)
    box.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus()
    return () => { removeEventListener('pointerdown', out); removeEventListener('keydown', key) }
  }, [open])
  return <>
    {defs.map((d, i) => <Button key={d.t} size={size} variant={variant ?? (i === 0 ? 'primary' : 'secondary')} disabled={pending} className={i > 0 ? 'max-sm:hidden' : undefined} onClick={() => make(d.t)}>
      {pending ? <Loader2 size={14} className="animate-spin" /> : <d.icon size={14} />}New {d.label.toLowerCase()}</Button>)}
    {rest.length > 0 && <div ref={box} className="relative sm:hidden">
      <Button type="button" size="icon" variant="secondary" aria-haspopup="menu" aria-expanded={open} aria-label="More new documents" disabled={pending} onClick={() => setOpen(o => !o)}>
        <ChevronDown size={16} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden /></Button>
      {open && <div role="menu" aria-label="New document" className="absolute end-0 z-pop mt-1.5 w-52 rounded-lg border border-border bg-surface p-1 shadow-pop">
        {rest.map(d => <button key={d.t} role="menuitem" type="button" onClick={() => { setOpen(false); make(d.t) }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2.5 text-start text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"><d.icon size={14} className="text-muted" aria-hidden />New {d.label.toLowerCase()}</button>)}
      </div>}
    </div>}
  </>
}

/** Phone "+" for a sales list: creates a numbered draft of that type and opens the builder. */
export function NewDocFab({ type, label }: { type: SalesType; label: string }) {
  const [pending, start] = useTransition(), token = useRef(crypto.randomUUID())
  return <button type="button" aria-label={label} disabled={pending} onClick={() => start(async () => { const r = await newSalesDoc(type, { token: token.current }); if (r?.error) toast(r.error, 'error') })}
    className="fab no-print fixed bottom-[calc(76px+env(safe-area-inset-bottom))] end-4 z-nav grid h-14 w-14 cursor-pointer place-items-center rounded-full bg-primary text-primary-fg shadow-[0_10px_24px_-6px_hsl(var(--primary)/.6)] transition-transform active:scale-95 disabled:opacity-70 lg:hidden">
    {pending ? <Loader2 size={22} className="animate-spin" /> : <Plus size={24} strokeWidth={2.4} />}</button>
}
