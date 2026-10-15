'use client'
import Link from 'next/link'
import { useTransition } from 'react'
import { FilePlus2, HardHat, Loader2, PackageCheck, Receipt, ScrollText, Target, Upload, UserPlus, Users, Wallet, ListPlus } from '@/components/icons'
import { newSalesDoc } from '@/app/actions/sales'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type Can = { sales: boolean; crm: boolean; docs: boolean; people: boolean; projects: boolean }
const TINT = ['bg-blue-500', 'bg-emerald-500', 'bg-orange-500', 'bg-violet-500', 'bg-rose-500', 'bg-sky-500', 'bg-teal-500', 'bg-amber-500', 'bg-indigo-500'].map(c => `${c} text-white shadow-[0_6px_14px_-6px_currentColor]`)

/** The things people start every day, one tap each. Sales documents are created as numbered drafts and open in the builder. */
export function QuickGrid({ can }: { can: Can }) {
  const [pending, start] = useTransition()
  const make = (t: 'quotation' | 'invoice' | 'delivery_note') => start(async () => { const r = await newSalesDoc(t, { token: crypto.randomUUID() }); if (r?.error) toast(r.error, 'error') })
  const items: { label: string; icon: typeof Receipt; run?: () => void; href?: string; show: boolean }[] = [
    { label: 'New quotation', icon: ScrollText, run: () => make('quotation'), show: can.sales },
    { label: 'New invoice', icon: Receipt, run: () => make('invoice'), show: can.sales },
    { label: 'New project', icon: HardHat, href: '/projects?new=project', show: can.projects },
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
  const tile = 'group flex min-h-[92px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-border bg-surface px-2 py-3 text-center text-[12.5px] font-medium transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-border-strong hover:shadow-md disabled:opacity-60'
  return <div className="grid grid-cols-3 gap-2.5 px-5 pb-5">{list.map((i, n) => {
    const body = <><span className={cn('grid h-10 w-10 place-items-center rounded-xl', TINT[n % TINT.length])} aria-hidden>{pending && i.run ? <Loader2 size={18} className="animate-spin" /> : <i.icon size={18} strokeWidth={1.9} />}</span><span className="leading-tight">{i.label}</span></>
    return i.href ? <Link key={i.label} href={i.href} className={tile}>{body}</Link>
      : <button key={i.label} type="button" disabled={pending} onClick={i.run} className={tile}>{body}</button>
  })}</div>
}
