'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowDown, ArrowLeft, ArrowUp, Building2, CheckCircle2, ChevronDown, Copy, Download, Eye, FileText, FolderArchive, Loader2, Mail,
  MoreHorizontal, PenLine, Plus, Printer, Receipt, Repeat, Save, ScrollText, Trash2, Truck, X,
} from 'lucide-react'
import { SalesPaper, type Branding, type PaperItem } from './paper'
import { FitPaper } from './preview'
import { Badge, Button, Input, Select, Textarea } from '@/components/ui/primitives'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { CONVERSIONS, DOC_META, STATUS_LABEL, STATUS_TONE, UNITS, manualStatuses, type SalesType } from '@/lib/sales/docs'
import { amountInWords, computeTotals, fmtMoney, lineAmount } from '@/lib/sales/money'
import { archivePdfToVault, convertSalesDoc, deleteSalesDraft, duplicateSalesDoc, saveSalesDoc, setSalesStatus, type SalesDocInput } from '@/app/actions/sales'
import type { ActionState } from '@/lib/utils'

export interface CustomerOpt { id: string; name: string; address: string | null; trn: string | null; phone: string | null; contact_person: string | null; email: string | null }
export interface ProjectOpt { id: string; name: string; code: string | null; customer_id: string | null; location: string | null }
type Item = PaperItem & { key: string; materials: string; unit: string }
type Head = Omit<SalesDocInput, 'items' | 'terms' | 'payment_terms'> & { termsText: string; paymentText: string }

const ICON: Record<string, typeof FileText> = { quotation: ScrollText, invoice: Receipt, delivery_note: Truck }
let seq = 0
const key = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`
const blank = (): Item => ({ key: key(), description: '', materials: '', quantity: 1, unit: 'Nos', unit_price: 0 })

export function SalesEditor({ doc, items: initialItems, branding, paid, customers, projects, editable, lockedReason, canStatus, canDelete, canVault }: {
  doc: Record<string, any>; items: PaperItem[]; branding: Branding; paid: number; customers: CustomerOpt[]; projects: ProjectOpt[]
  editable: boolean; lockedReason?: string | null; canStatus: boolean; canDelete: boolean; canVault: boolean
}) {
  const t = doc.doc_type as SalesType, meta = DOC_META[t], isInv = t === 'invoice', isQtn = t === 'quotation', isDn = t === 'delivery_note'
  const [head, setHead] = useState<Head>(() => ({
    customer_id: doc.customer_id, new_customer: false, project_id: doc.project_id, issue_date: doc.issue_date, due_date: doc.due_date ?? '', valid_until: doc.valid_until ?? '',
    attention: doc.attention ?? '', customer_name: doc.customer_name ?? '', customer_address: doc.customer_address ?? '', customer_trn: doc.customer_trn ?? '', customer_phone: doc.customer_phone ?? '',
    site: doc.site ?? '', subject: doc.subject ?? '', reference: doc.reference ?? '', lpo_ref: doc.lpo_ref ?? '', intro: doc.intro ?? '', closing: doc.closing ?? '',
    receiver_name: doc.receiver_name ?? '', vehicle_no: doc.vehicle_no ?? '', notes: doc.notes ?? '',
    vat_rate: Number(doc.vat_rate ?? 5), discount: Number(doc.discount ?? 0), show_total: doc.show_total !== false,
    termsText: (doc.terms ?? []).join('\n'), paymentText: (doc.payment_terms ?? []).join('\n'),
  }))
  const [items, setItems] = useState<Item[]>(() => initialItems.length ? initialItems.map(i => ({ ...i, key: key(), materials: i.materials ?? '', unit: i.unit ?? 'Nos' })) : [blank()])
  const router = useRouter()
  const [dirty, setDirty] = useState(false)
  const [saving, startSave] = useTransition()
  const [busy, startBusy] = useTransition()
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [errors, setErrors] = useState<string | null>(null)

  const set = <K extends keyof Head>(k: K, v: Head[K]) => { setHead(h => ({ ...h, [k]: v })); setDirty(true) }
  const setItem = (i: number, patch: Partial<Item>) => { setItems(xs => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true) }
  const move = (i: number, d: -1 | 1) => { setItems(xs => { const n = [...xs]; const j = i + d; if (j < 0 || j >= n.length) return xs; [n[i], n[j]] = [n[j], n[i]]; return n }); setDirty(true) }
  const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean)

  const paperDoc = useMemo(() => ({
    ...doc, ...head, doc_type: t, number: doc.number, due_date: head.due_date || null, valid_until: head.valid_until || null,
    terms: lines(head.termsText), payment_terms: lines(head.paymentText), vat_rate: Number(head.vat_rate) || 0, discount: Number(head.discount) || 0,
  }), [doc, head, t])
  const paperItems = useMemo(() => items.filter(i => i.description.trim() || Number(i.unit_price) || i === items[0]), [items])
  const tot = computeTotals(paperItems, Number(head.vat_rate) || 0, Number(head.discount) || 0, isInv)

  const payload = useCallback((): SalesDocInput => {
    const { termsText, paymentText, ...h } = head
    return {
      ...h, customer_id: h.customer_id || null, project_id: h.project_id || null, terms: lines(termsText), payment_terms: lines(paymentText),
      items: items.filter(i => i.description.trim()).map(({ key: _k, ...i }) => ({ ...i, quantity: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0, materials: i.materials || null })),
    }
  }, [head, items])

  const save = useCallback((then?: () => void) => {
    if (!editable) { then?.(); return }
    startSave(async () => {
      const r: ActionState = await saveSalesDoc(doc.id, payload())
      if (r?.error) { setErrors(r.error); toast(r.error, 'error'); return }
      setErrors(null); setDirty(false); toast(`${meta.label} ${doc.number} saved`)
      if (r?.data?.customerId) setHead(h => ({ ...h, new_customer: false, customer_id: r.data!.customerId }))
      if (head.new_customer) router.refresh()
      then?.()
    })
  }, [editable, doc.id, doc.number, payload, meta.label, head.new_customer, router])

  // Ctrl/Cmd+S saves; warn before leaving with unsaved changes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save() } }
    const onLeave = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('keydown', onKey); window.addEventListener('beforeunload', onLeave)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave) }
  }, [dirty, save])

  const run = (fn: () => Promise<ActionState>, opts: { confirm?: string; saveFirst?: boolean } = {}) => {
    if (opts.confirm && !window.confirm(opts.confirm)) return
    const go = () => startBusy(async () => {
      const r = await fn()
      if (r?.error) toast(r.error, 'error'); else if (r?.message) toast(r.message)
    })
    if (opts.saveFirst && dirty) save(go); else go()
  }
  const pickCustomer = (id: string) => {
    const cu = customers.find(c => c.id === id)
    setHead(h => cu ? { ...h, customer_id: cu.id, new_customer: false, customer_name: cu.name, customer_address: cu.address ?? '', customer_trn: cu.trn ?? '', customer_phone: cu.phone ?? '', attention: cu.contact_person ?? h.attention }
      : { ...h, customer_id: null })
    setDirty(true)
  }
  const pickProject = (id: string) => {
    const p = projects.find(x => x.id === id)
    setHead(h => ({ ...h, project_id: id || null, site: p?.location && !h.site ? p.location : h.site }))
    if (p?.customer_id && !head.customer_id) pickCustomer(p.customer_id)
    setDirty(true)
  }
  const customer = customers.find(c => c.id === head.customer_id)
  const mail = `mailto:${encodeURIComponent(customer?.email ?? '')}?subject=${encodeURIComponent(`${meta.label} ${doc.number}${head.subject ? ' — ' + head.subject : ''}`)}&body=${encodeURIComponent(
    `Dear ${head.attention || 'Sir/Madam'},\n\nPlease find attached our ${meta.label.toLowerCase()} ${doc.number}${meta.priced ? ` for AED ${fmtMoney(tot.total)}` : ''}.\n\nKind regards,\n${branding.companyName}`)}`
  const Icon = ICON[t] ?? FileText
  const statuses = canStatus ? manualStatuses(t, doc.status) : []

  return <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
    {/* toolbar */}
    <div className="no-print sticky top-14 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-surface/90 px-4 py-2.5 backdrop-blur sm:px-6">
      <Link href="/invoices" aria-label="Back to sales documents" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"><ArrowLeft size={17} /></Link>
      <span className="hidden rounded-md bg-primary-soft p-1.5 text-primary sm:inline-flex"><Icon size={16} aria-hidden /></span>
      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-2"><h1 className="truncate text-sm font-semibold">{meta.label} {doc.number}</h1><Badge tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status] ?? doc.status}</Badge></div>
        <div className="text-[11px] text-muted" aria-live="polite">{!editable ? (lockedReason ?? 'Read only') : saving ? 'Saving…' : dirty ? 'Unsaved changes · Ctrl+S to save' : 'All changes saved'}</div>
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-1.5">
        <div className="flex rounded-md border border-border p-0.5 lg:hidden" role="tablist" aria-label="Editor view">
          {(['edit', 'preview'] as const).map(v => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn('flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-xs font-medium capitalize', view === v ? 'bg-primary text-primary-fg' : 'text-muted')}>{v === 'edit' ? <PenLine size={13} /> : <Eye size={13} />}{v}</button>)}
        </div>
        {editable && <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save</Button>}
        <Button size="sm" variant="secondary" onClick={() => (dirty ? save(() => window.open(`/print/sales/${doc.id}?auto=1`, '_blank')) : window.open(`/print/sales/${doc.id}?auto=1`, '_blank'))}><Printer size={14} /><span className="hidden sm:inline">Print</span></Button>
        <Button size="sm" variant="secondary" onClick={() => (dirty ? save(() => { location.href = `/api/sales/${doc.id}/pdf` }) : (location.href = `/api/sales/${doc.id}/pdf`))}><Download size={14} /><span className="hidden sm:inline">PDF</span></Button>
        <Menu label={<><MoreHorizontal size={15} /><span className="sr-only">More actions</span></>} busy={busy}>
          {canVault && <MenuItem icon={FolderArchive} onClick={() => run(() => archivePdfToVault(doc.id), { saveFirst: true })}>Save PDF to Document Vault</MenuItem>}
          <MenuItem icon={Mail} href={mail}>Email to customer…</MenuItem>
          {canStatus && (CONVERSIONS[t] ?? []).map(to => <MenuItem key={to} icon={Repeat} onClick={() => run(() => convertSalesDoc(doc.id, to), { saveFirst: true })}>Create {DOC_META[to].label}</MenuItem>)}
          {canStatus && <MenuItem icon={Copy} onClick={() => run(() => duplicateSalesDoc(doc.id), { saveFirst: true })}>Duplicate</MenuItem>}
          {statuses.length > 0 && <div className="my-1 border-t border-border" role="separator" />}
          {statuses.map(s => <MenuItem key={s} icon={s === 'cancelled' ? X : CheckCircle2} danger={s === 'cancelled'}
            onClick={() => run(() => setSalesStatus(doc.id, s), { saveFirst: true, confirm: s === 'cancelled' ? `Cancel ${doc.number}? It stays on record but can no longer be edited.` : undefined })}>
            {isInv && s === 'sent' ? 'Issue invoice (mark as sent)' : `Mark as ${STATUS_LABEL[s].toLowerCase()}`}</MenuItem>)}
          {canDelete && doc.status === 'draft' && <><div className="my-1 border-t border-border" role="separator" />
            <MenuItem icon={Trash2} danger onClick={() => run(() => deleteSalesDraft(doc.id), { confirm: `Delete draft ${doc.number}? This cannot be undone.` })}>Delete draft</MenuItem></>}
        </Menu>
      </div>
    </div>

    <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(380px,520px)_1fr]">
      {/* ── editor ── */}
      <div className={cn('flex flex-col gap-4', view === 'preview' && 'hidden lg:flex')}>
        {errors && <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{errors}</div>}
        {!editable && lockedReason && <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">{lockedReason}</div>}
        <fieldset disabled={!editable} className="contents">
          <Section icon={Building2} title={isDn ? 'Customer & delivery' : 'Customer'} sub={`${meta.label} recipient`}>
            <F label="Customer">
              <Select value={head.customer_id ?? ''} onChange={e => pickCustomer(e.target.value)}>
                <option value="">— One-off / new customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </F>
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Company name"><Input value={head.customer_name ?? ''} onChange={e => set('customer_name', e.target.value)} placeholder="e.g. ABC Contracting LLC" /></F>
              <F label={isQtn ? 'Attention (contact name)' : 'Contact person'}><Input value={head.attention ?? ''} onChange={e => set('attention', e.target.value)} placeholder="e.g. Mr. Ahmed" /></F>
            </div>
            {!head.customer_id && head.customer_name && <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={!!head.new_customer} onChange={e => set('new_customer', e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />Save “{head.customer_name}” as a customer</label>}
            <F label="Address"><Textarea rows={2} value={head.customer_address ?? ''} onChange={e => set('customer_address', e.target.value)} placeholder="e.g. Musaffah M-44, Abu Dhabi" /></F>
            <div className="grid gap-3 sm:grid-cols-2">
              {!isQtn && <F label="Customer TRN" hint="15 digits"><Input inputMode="numeric" value={head.customer_trn ?? ''} onChange={e => set('customer_trn', e.target.value)} placeholder="100xxxxxxxxxxxx" /></F>}
              <F label="Phone"><Input type="tel" value={head.customer_phone ?? ''} onChange={e => set('customer_phone', e.target.value)} placeholder="+971 …" /></F>
              <F label={isDn ? 'Delivery to' : 'Working place / site'} className={isQtn ? '' : 'sm:col-span-2'}><Input value={head.site ?? ''} onChange={e => set('site', e.target.value)} placeholder="e.g. Villa 22, Fujairah" /></F>
            </div>
          </Section>

          <Section icon={Icon} title={`${meta.label} details`} sub="Number, dates and references">
            <div className="grid gap-3 sm:grid-cols-2">
              <F label={`${meta.label} no.`} hint="Assigned automatically"><Input value={doc.number} readOnly className="bg-surface-2 font-mono" /></F>
              <F label="Date"><Input type="date" value={head.issue_date} onChange={e => set('issue_date', e.target.value)} required /></F>
              {isInv && <F label="Due date"><Input type="date" value={head.due_date ?? ''} onChange={e => set('due_date', e.target.value)} /></F>}
              {isQtn && <F label="Valid until"><Input type="date" value={head.valid_until ?? ''} onChange={e => set('valid_until', e.target.value)} /></F>}
              {!isQtn && <F label="L.P.O. / PO ref."><Input value={head.lpo_ref ?? ''} onChange={e => set('lpo_ref', e.target.value)} /></F>}
              <F label="Project">
                <Select value={head.project_id ?? ''} onChange={e => pickProject(e.target.value)}>
                  <option value="">— No project —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}
                </Select>
              </F>
              <F label="Subject" className="sm:col-span-2"><Input value={head.subject ?? ''} onChange={e => set('subject', e.target.value)} placeholder="e.g. Steel staircase — Villa 22" /></F>
              {isDn && <><F label="Receiver name"><Input value={head.receiver_name ?? ''} onChange={e => set('receiver_name', e.target.value)} /></F>
                <F label="Vehicle no."><Input value={head.vehicle_no ?? ''} onChange={e => set('vehicle_no', e.target.value)} /></F></>}
            </div>
          </Section>

          <Section icon={FileText} title={isDn ? 'Items delivered' : 'Scope of works'} sub={`${items.length} line${items.length === 1 ? '' : 's'}${meta.priced ? ` · AED ${fmtMoney(tot.subtotal)}` : ''}`}>
            <ol className="flex flex-col gap-3">
              {items.map((it, i) => <li key={it.key} className="rounded-lg border border-border bg-surface-2/40 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-fg">{i + 1}</span>
                  <span className="text-xs font-medium text-muted">{meta.priced && Number(it.unit_price) > 0 ? `AED ${fmtMoney(lineAmount(it))}` : 'Line ' + (i + 1)}</span>
                  {editable && <div className="ms-auto flex items-center gap-0.5">
                    <IconBtn label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={14} /></IconBtn>
                    <IconBtn label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDown size={14} /></IconBtn>
                    <IconBtn label="Duplicate line" onClick={() => { setItems(xs => [...xs.slice(0, i + 1), { ...it, key: key() }, ...xs.slice(i + 1)]); setDirty(true) }}><Copy size={14} /></IconBtn>
                    <IconBtn label="Remove line" danger onClick={() => { setItems(xs => xs.length > 1 ? xs.filter((_, j) => j !== i) : [blank()]); setDirty(true) }}><Trash2 size={14} /></IconBtn>
                  </div>}
                </div>
                <Textarea aria-label={`Line ${i + 1} description`} rows={2} value={it.description} onChange={e => setItem(i, { description: e.target.value })} placeholder="e.g. Supply and installation of steel staircase with handrail" />
                {isQtn && <Input aria-label={`Line ${i + 1} materials`} className="mt-2" value={it.materials} onChange={e => setItem(i, { materials: e.target.value })} placeholder="Materials to be used (optional)" />}
                <div className={cn('mt-2 grid gap-2', meta.priced ? 'grid-cols-[1fr_1fr_1.3fr]' : 'grid-cols-2')}>
                  <F label="Qty" small><Input type="number" min={0} step="any" inputMode="decimal" value={it.quantity} onChange={e => setItem(i, { quantity: e.target.value })} /></F>
                  <F label="Unit" small><Select value={it.unit} onChange={e => setItem(i, { unit: e.target.value })}>{[...new Set([...UNITS, it.unit])].map(u => <option key={u}>{u}</option>)}</Select></F>
                  {meta.priced && <F label="Rate (AED)" small><Input type="number" min={0} step="0.01" inputMode="decimal" value={it.unit_price} onChange={e => setItem(i, { unit_price: e.target.value })} /></F>}
                </div>
              </li>)}
            </ol>
            {editable && <Button type="button" variant="secondary" className="mt-1 w-full border-dashed" onClick={() => { setItems(xs => [...xs, blank()]); setDirty(true) }}><Plus size={15} />Add line</Button>}
          </Section>

          {meta.priced && <Section icon={Receipt} title="Totals" sub={isInv ? 'VAT is applied per line' : 'VAT is noted, not added, on quotations'}>
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="VAT rate (%)"><Input type="number" min={0} max={100} step="0.01" value={head.vat_rate as number} onChange={e => set('vat_rate', e.target.value as any)} /></F>
              <F label="Discount (AED)"><Input type="number" min={0} step="0.01" value={head.discount as number} onChange={e => set('discount', e.target.value as any)} /></F>
            </div>
            {isQtn && <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={!!head.show_total} onChange={e => set('show_total', e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />Show the total row on the quotation</label>}
            <dl className="rounded-lg bg-surface-2/60 p-3 text-sm tabular-nums">
              <Row k="Subtotal" v={fmtMoney(tot.subtotal)} />
              {tot.discount > 0 && <Row k="Discount" v={`− ${fmtMoney(tot.discount)}`} />}
              {isInv && <Row k={`VAT ${head.vat_rate}%`} v={fmtMoney(tot.vat)} />}
              <Row k={isInv ? 'Grand total' : 'Total'} v={`AED ${fmtMoney(tot.total)}`} strong />
              {isInv && paid > 0 && <><Row k="Paid" v={fmtMoney(paid)} /><Row k="Balance" v={`AED ${fmtMoney(tot.total - paid)}`} strong /></>}
              <p className="mt-2 text-xs text-muted">{amountInWords(tot.total)}</p>
            </dl>
          </Section>}

          {isQtn && <Section icon={ScrollText} title="Letter & terms" sub="Defaults come from Settings → Documents" collapsed>
            <F label="Opening"><Textarea rows={3} value={head.intro ?? ''} onChange={e => set('intro', e.target.value)} /></F>
            <F label="Closing note"><Textarea rows={3} value={head.closing ?? ''} onChange={e => set('closing', e.target.value)} /></F>
            <F label="Terms and conditions" hint="One per line"><Textarea rows={3} value={head.termsText} onChange={e => set('termsText', e.target.value)} /></F>
            <F label="Payment terms" hint="One per line"><Textarea rows={3} value={head.paymentText} onChange={e => set('paymentText', e.target.value)} /></F>
          </Section>}

          <Section icon={PenLine} title="Internal notes" sub="Never printed" collapsed={!head.notes}>
            <Textarea rows={3} value={head.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Notes for your team only" />
          </Section>
        </fieldset>
      </div>

      {/* ── live preview ── */}
      <div className={cn('min-w-0', view === 'edit' && 'hidden lg:block')}>
        <div className="sticky top-32">
          <div className="mb-2 flex items-center justify-between text-xs text-muted"><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />Live A4 preview</span><span>Exactly what prints</span></div>
          <div className="rounded-xl bg-[repeating-linear-gradient(45deg,hsl(var(--surface-2)),hsl(var(--surface-2))_10px,hsl(var(--bg))_10px,hsl(var(--bg))_20px)] p-3 sm:p-5">
            <FitPaper><SalesPaper doc={paperDoc as any} items={paperItems} branding={branding} paid={paid} /></FitPaper>
          </div>
        </div>
      </div>
    </div>
  </div>
}

function Section({ icon: Icon, title, sub, children, collapsed }: { icon: typeof FileText; title: string; sub?: string; children: ReactNode; collapsed?: boolean }) {
  return <details open={!collapsed} className="group rounded-lg border border-border bg-surface shadow-card">
    <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
      <span className="rounded-md bg-primary-soft p-1.5 text-primary"><Icon size={15} aria-hidden /></span>
      <span className="flex-1"><span className="block text-sm font-semibold">{title}</span>{sub && <span className="block text-xs text-muted">{sub}</span>}</span>
      <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" aria-hidden />
    </summary>
    <div className="flex flex-col gap-3 border-t border-border px-4 py-4">{children}</div>
  </details>
}
function F({ label, hint, children, className, small }: { label: string; hint?: string; children: ReactNode; className?: string; small?: boolean }) {
  return <label className={cn('flex flex-col gap-1', className)}><span className={cn('font-medium', small ? 'text-[11px] text-muted' : 'text-xs')}>{label}</span>{children}{hint && <span className="text-[11px] text-muted">{hint}</span>}</label>
}
function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={cn('flex justify-between py-0.5', strong && 'mt-1 border-t border-border pt-1.5 font-semibold')}><dt className={strong ? '' : 'text-muted'}>{k}</dt><dd>{v}</dd></div>
}
function IconBtn({ label, children, danger, ...p }: { label: string; children: ReactNode; danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" aria-label={label} title={label} className={cn('grid h-8 w-8 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface disabled:cursor-default disabled:opacity-30', danger ? 'hover:text-danger' : 'hover:text-fg')} {...p}>{children}</button>
}

function Menu({ label, children, busy }: { label: ReactNode; children: ReactNode; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  return <div ref={ref} className="relative" onClick={e => { if ((e.target as HTMLElement).closest('[role=menuitem]')) setOpen(false) }}>
    <Button size="sm" variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : label}</Button>
    {open && <div role="menu" className="toast-in absolute end-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-surface p-1 shadow-xl">{children}</div>}
  </div>
}
function MenuItem({ icon: Icon, children, onClick, href, danger }: { icon: typeof FileText; children: ReactNode; onClick?: () => void; href?: string; danger?: boolean }) {
  const cls = cn('flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm hover:bg-surface-2', danger && 'text-danger')
  return href ? <a role="menuitem" href={href} className={cls}><Icon size={15} aria-hidden />{children}</a>
    : <button role="menuitem" type="button" onClick={onClick} className={cls}><Icon size={15} aria-hidden />{children}</button>
}
