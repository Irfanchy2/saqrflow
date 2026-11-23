'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileText, Printer, Search, X } from '@/components/icons'
import { cn } from '@/lib/utils'

type Opt = { id: string; name: string }
let shared: Promise<Opt[]> | null = null
// fresh list each time the picker is opened (no HTTP cache: a customer added a moment ago must be there)
const loadCustomers = () => (shared ??= fetch('/api/options/customers', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { options: [] })).then(d => d.options as Opt[]).catch(() => { shared = null; return [] }))
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const TYPES = [
  { v: 'unpaid', title: 'Unpaid invoices only', body: 'Only the invoices not fully paid: amount, paid, balance due and days late, with an ageing summary.' },
  { v: 'full', title: 'Full statement of account', body: 'Every invoice, payment and credit note with a running balance, plus the open invoices.' },
] as const

/**
 * Customer statement: pick one customer (search by name), choose unpaid invoices only or the full statement, optionally
 * a period, then open it to print or download the PDF. Uses the same statement pages as Customers → Ledger & statement.
 */
export function StatementPicker({ customer: preset, defaultType = 'unpaid' }: { customer?: Opt | null; defaultType?: 'unpaid' | 'full' }) {
  const [opts, setOpts] = useState<Opt[] | null>(null)
  const [q, setQ] = useState(''), [picked, setPicked] = useState<Opt | null>(preset ?? null)
  const [type, setType] = useState<'unpaid' | 'full'>(defaultType), [from, setFrom] = useState(''), [to, setTo] = useState(''), [err, setErr] = useState('')
  const root = useRef<HTMLDivElement>(null)
  // load the customers only when the picker is actually shown (its dialog opened), never with the page itself
  useEffect(() => {
    const el = root.current; if (preset || !el) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); shared = null; loadCustomers().then(setOpts) } })
    io.observe(el); return () => io.disconnect()
  }, [preset])
  const matches = useMemo(() => {
    if (!opts) return []
    const words = norm(q).split(' ').filter(Boolean)
    return (words.length ? opts.filter(o => { const n = norm(o.name); return words.every(w => n.includes(w)) }) : opts).slice(0, 8)
  }, [opts, q])
  const qs = new URLSearchParams(Object.entries({ type: type === 'unpaid' ? 'unpaid' : '', from, to }).filter(([, v]) => v)).toString()
  const go = (kind: 'print' | 'pdf') => {
    if (!picked) { setErr('Choose a customer first.'); return }
    if (from && to && from > to) { setErr('The “From” date is after the “To” date.'); return }
    setErr('')
    if (kind === 'print') window.open(`/print/statement/${picked.id}?${qs}`, '_blank', 'noopener')
    else location.href = `/api/statements/${picked.id}?${qs}`
  }
  const box = 'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm sm:h-10'
  return <div ref={root} className="space-y-5" data-statement-picker>
    <div>
      <div className="mb-1.5 text-sm font-medium">Customer</div>
      {picked ? <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary-soft px-3 py-2" data-statement-customer>
          <span className="min-w-0 truncate font-medium">{picked.name}</span>
          {!preset && <button type="button" onClick={() => { setPicked(null); setQ('') }} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-primary hover:bg-surface"><X size={14} aria-hidden />Change</button>}
        </div>
        : <div>
          <div className="relative"><Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" aria-label="Search customer" placeholder="Type a customer name, e.g. GTSC" className={cn(box, 'ps-9')} autoFocus /></div>
          <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Customers">
            {!opts ? <li className="px-3 py-2.5 text-sm text-muted">Loading customers…</li>
              : matches.length === 0 ? <li className="px-3 py-2.5 text-sm text-muted">No customer matches “{q}”.</li>
              : matches.map(o => <li key={o.id}><button type="button" role="option" aria-selected={false} onClick={() => { setPicked(o); setErr('') }} className="block min-h-11 w-full px-3 py-2.5 text-start text-sm hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">{o.name}</button></li>)}
          </ul></div>}
    </div>

    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">What to include</legend>
      <div className="grid gap-2 sm:grid-cols-2">{TYPES.map(t => <label key={t.v} className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors', type === t.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-2')}>
        <input type="radio" name="statement_type" value={t.v} checked={type === t.v} onChange={() => setType(t.v)} className="mt-1" />
        <span><span className="block text-sm font-medium">{t.title}</span><span className="mt-0.5 block text-xs text-muted">{t.body}</span></span></label>)}</div>
    </fieldset>

    <div>
      <div className="mb-1.5 text-sm font-medium">Period <span className="font-normal text-muted">(optional)</span></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-muted">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={cn(box, 'mt-1 text-fg')} /></label>
        <label className="text-xs text-muted">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className={cn(box, 'mt-1 text-fg')} /></label>
      </div>
      <p className="mt-1.5 text-xs text-muted">{type === 'unpaid' ? 'Empty = every unpaid invoice. With dates: unpaid invoices issued in that period.' : 'Empty = the whole account. With dates: the period, with the balance brought forward.'}</p>
    </div>

    <p className="text-xs text-muted">Old invoices from before Averiqo missing? Add them with their own numbers under <a href="/invoices/previous" className="font-medium text-primary hover:underline">Previous invoices</a>; they then appear on the statement.</p>
    {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {picked && <a href={`/parties/${picked.id}/ledger${qs ? `?${qs}` : ''}`} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm text-primary hover:bg-surface-2 sm:h-10"><FileText size={15} aria-hidden />Open ledger</a>}
      <button type="button" onClick={() => go('pdf')} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2 sm:h-10" data-statement-pdf><Download size={15} aria-hidden />Download PDF</button>
      <button type="button" onClick={() => go('print')} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-fg hover:opacity-90 sm:h-10" data-statement-view><Printer size={15} aria-hidden />View &amp; print</button>
    </div>
  </div>
}
