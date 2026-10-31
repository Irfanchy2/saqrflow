'use client'
import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveClaims } from '@/app/actions/claims'
import { AccountSelect } from '@/components/banking/account-select'
import { Badge, Button, Money } from '@/components/ui/primitives'
import { AlertTriangle, CheckCircle2, Loader2, ScanText, X } from '@/components/icons'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export type QueueRow = {
  id: string; href: string; title: string; sub: string; total: number; scanned: boolean; active: boolean
  status: { label: string; tone?: 'neutral' | 'blue' | 'green' | 'amber' | 'red' }
  /** the approver's own claim: someone else decides it */
  own: boolean
  /** same supplier and receipt number as a saved expense or another claim */
  dup: boolean
}

/**
 * The employee claims list. On the Waiting tab, approvers can tick claims (or Select all) and approve them together; the
 * approver's own claims and possible duplicates are left out of Select all (a duplicate can still be ticked by hand).
 * Every claim is still approved on its own on the server, exactly as when opened one by one.
 */
export function ClaimsQueue({ rows, selectable }: { rows: QueueRow[]; selectable: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set()), [confirm, setConfirm] = useState(false), [pending, start] = useTransition()
  const router = useRouter()
  const eligible = useMemo(() => rows.filter(r => !r.own && !r.dup), [rows])
  const chosen = rows.filter(r => sel.has(r.id)), total = chosen.reduce((s, r) => s + r.total, 0)
  const allOn = eligible.length > 0 && eligible.every(r => sel.has(r.id))
  const excluded = rows.filter(r => r.dup && !r.own).length
  const toggle = (id: string) => { setConfirm(false); setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  const toggleAll = () => { setConfirm(false); setSel(allOn ? new Set() : new Set(eligible.map(r => r.id))) }
  const approve = (form: HTMLFormElement | null) => start(async () => {
    const bank = form ? String(new FormData(form).get('paid_from_bank_id') ?? '') : ''
    const r = await approveClaims([...sel], bank || null)
    if (r?.error) { toast(r.error, 'error'); setConfirm(false); return }
    toast(r?.message ?? 'Approved.'); setSel(new Set()); setConfirm(false); router.refresh()
  })

  return <>
    {selectable && eligible.length > 0 && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-[13.5px]" data-claims-select>
      <label className="-my-1.5 flex min-h-11 cursor-pointer items-center gap-3 font-medium sm:min-h-9">
        <input type="checkbox" checked={allOn} onChange={toggleAll} className="h-5 w-5 accent-[hsl(var(--primary))]" data-claims-select-all aria-label={`Select all ${eligible.length} claims`} />
        Select all ({eligible.length})</label>
      {excluded > 0 && <span className="text-[12.5px] text-muted">{excluded} possible duplicate{excluded === 1 ? ' is' : 's are'} left out: open {excluded === 1 ? 'it' : 'them'} to check, or tick by hand.</span>}
    </div>}
    <ul className={cn('divide-y divide-border', selectable && sel.size > 0 && 'pb-48 sm:pb-32')} data-claims-queue>{rows.map(r => <li key={r.id} className={cn('flex items-center', r.active && 'bg-primary-soft/40', sel.has(r.id) && 'bg-primary-soft/25')}>
      {selectable && <label className="flex min-h-[60px] w-12 shrink-0 cursor-pointer items-center justify-center self-stretch ps-1" title={r.own ? 'Your own claim: another approver decides it' : undefined}>
        <input type="checkbox" checked={sel.has(r.id)} disabled={r.own} onChange={() => toggle(r.id)} className="h-5 w-5 accent-[hsl(var(--primary))] disabled:opacity-40" data-claim-check={r.id} aria-label={`Select ${r.title}`} /></label>}
      <Link href={r.href} scroll={false} data-claim-row={r.id} className={cn('flex min-w-0 flex-1 items-center gap-3 py-3 pe-4 text-sm transition-colors hover:bg-surface-2/50', !selectable && 'ps-4')}>
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.title}</span>
          <span className="block truncate text-xs text-muted">{r.sub}</span>
          {r.dup && <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-danger" data-claim-dup><AlertTriangle size={12} aria-hidden />Possible duplicate</span>}</span>
        {r.scanned && <ScanText size={14} className="hidden shrink-0 text-muted sm:block" aria-hidden />}
        <Money value={r.total} className="shrink-0 font-semibold" />
        <Badge tone={r.status.tone} className="hidden shrink-0 sm:inline-flex">{r.status.label}</Badge></Link></li>)}</ul>

    {/* the approve bar: above the phone tab bar, within thumb reach */}
    {selectable && sel.size > 0 && <form onSubmit={e => e.preventDefault()} className="fixed inset-x-3 bottom-[calc(96px+env(safe-area-inset-bottom))] z-nav mx-auto max-w-2xl rounded-2xl bg-surface p-3 shadow-pop ring-1 ring-border lg:bottom-6" data-claims-bar role="region" aria-label="Approve selected claims">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"><CheckCircle2 size={18} aria-hidden /></span>
        <div className="min-w-0 flex-1 leading-tight"><div className="text-[14px] font-semibold">{sel.size} selected</div><div className="text-[12.5px] text-muted">Total <Money value={total} /></div></div>
        <button type="button" onClick={() => { setSel(new Set()); setConfirm(false) }} className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-2" aria-label="Clear selection"><X size={16} /></button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <AccountSelect name="paid_from_bank_id" label="Paid back from" className="min-w-0" />
        {confirm ? <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setConfirm(false)} disabled={pending}>Cancel</Button>
          <Button type="button" className="flex-1 bg-success text-white hover:bg-success/90 sm:flex-none" disabled={pending} onClick={e => approve(e.currentTarget.form)} data-claims-confirm>
            {pending && <Loader2 size={15} className="animate-spin" />}Confirm: approve {sel.size}</Button></div>
          : <Button type="button" className="h-11 sm:h-10" onClick={() => setConfirm(true)} data-claims-approve><CheckCircle2 size={16} aria-hidden />Approve {sel.size} · add to expenses</Button>}
      </div>
      {confirm && <p className="mt-2 text-[12.5px] text-muted">Each claim is added to expenses with the employee&apos;s own category and project. To change those, or to send one back, open it instead.</p>}
    </form>}
  </>
}
