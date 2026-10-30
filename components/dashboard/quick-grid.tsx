'use client'
import Link from 'next/link'
import { useTransition } from 'react'
import { FilePlus2, Loader2, PackageCheck, Receipt, ScrollText, Target, Upload, UserPlus, Users, Wallet, ListPlus, ProjectDoc } from '@/components/icons'
import { newSalesDoc } from '@/app/actions/sales'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type Can = { sales: boolean; crm: boolean; docs: boolean; people: boolean; projects: boolean }
// solid tiles with a top highlight and a shadow in their own colour (the same recipe as filled buttons)
const TINT = ['bg-blue-500 [--t:217_91%_60%]', 'bg-emerald-500 [--t:160_84%_39%]', 'bg-orange-500 [--t:25_95%_53%]', 'bg-violet-500 [--t:258_90%_66%]', 'bg-rose-500 [--t:350_89%_60%]', 'bg-sky-500 [--t:199_89%_48%]', 'bg-teal-500 [--t:173_80%_40%]', 'bg-amber-500 [--t:38_92%_50%]', 'bg-indigo-500 [--t:239_84%_67%]'].map(c => `${c} bg-[linear-gradient(180deg,hsl(0_0%_100%/.2),hsl(0_0%_100%/0))] text-white shadow-[inset_0_1px_0_hsl(0_0%_100%/.3),0_6px_14px_-6px_hsl(var(--t)/.8)]`)

/** The things people start every day, one tap each. Sales documents are created as numbered drafts and open in the builder. */
export function QuickGrid({ can }: { can: Can }) {
  const [pending, start] = useTransition()
  const make = (t: 'quotation' | 'invoice' | 'delivery_note') => start(async () => { const r = await newSalesDoc(t, { token: crypto.randomUUID() }); if (r?.error) toast(r.error, 'error') })
  const items: { label: string; icon: typeof Receipt; run?: () => void; href?: string; show: boolean }[] = [
    { label: 'New quotation', icon: ScrollText, run: () => make('quotation'), show: can.sales },
    { label: 'New invoice', icon: Receipt, run: () => make('invoice'), show: can.sales },
    { label: 'New project', icon: ProjectDoc, href: '/projects?new=project', show: can.projects },
    { label: 'New lead', icon: Target, href: '/leads?new=lead', show: can.crm },
    { label: 'Add expense', icon: Wallet, href: '/expenses?new=expense', show: can.sales },
    { label: 'Add customer', icon: UserPlus, href: '/parties?new=customer', show: can.people },
    { label: 'Add employee', icon: Users, href: '/employees?new=employee', show: can.people },
    { label: 'Delivery note', icon: PackageCheck, run: () => make('delivery_note'), show: can.sales },
    { label: 'Upload document', icon: Upload, href: '/inbox', show: can.docs },
    { label: 'New task', icon: ListPlus, href: '/tasks?new=task', show: true },
    { label: 'Smart document', icon: FilePlus2, href: '/documents?new=document', show: can.docs },
  ]
  const list = items.filter(i => i.show).slice(0, 9)
  // compact, borderless tiles: a small colour tile and a short label; the press and hover states carry the affordance.
  // Phones show 8 (two full rows of four); the desktop card shows 9 (three rows of three).
  const tile = 'group flex min-h-[78px] cursor-pointer flex-col items-center justify-start gap-2 rounded-xl px-1 pb-2 pt-2.5 text-center text-[12px] font-medium leading-[1.25] text-fg/85 transition-[background-color,transform] duration-150 ease-out hover:bg-surface-2/80 active:scale-[.96] active:bg-surface-2 disabled:opacity-60 max-sm:[&:nth-child(9)]:hidden'
  return <div className="grid grid-cols-4 gap-1 px-3 pb-3 sm:grid-cols-3 sm:px-4 sm:pb-4">{list.map((i, n) => {
    const body = <><span className={cn('grid h-9 w-9 place-items-center rounded-[11px] transition-transform duration-200 ease-out group-hover:-translate-y-0.5', TINT[n % TINT.length])} aria-hidden>{pending && i.run ? <Loader2 size={17} className="animate-spin" /> : <i.icon size={17} strokeWidth={1.9} />}</span><span className="line-clamp-2 max-w-[11ch]">{i.label}</span></>
    return i.href ? <Link key={i.label} href={i.href} className={tile}>{body}</Link>
      : <button key={i.label} type="button" disabled={pending} onClick={i.run} className={tile}>{body}</button>
  })}</div>
}
