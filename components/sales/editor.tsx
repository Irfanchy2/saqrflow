'use client'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowDown, ArrowLeft, ArrowUp, Building2, CheckCircle2, ChevronDown, Copy, Download, Eye, FileMinus, FileText, FolderArchive, Loader2, Mail, MessageCircle,
  MoreHorizontal, PenLine, Plus, Printer, Receipt, Repeat, Save, ScrollText, Send, Trash2, Truck, X,
} from 'lucide-react'
import { SalesPaper, docDiscount, vatOn, type Branding, type PaperItem } from './paper'
import { FitPaper } from './preview'
import { CustomerPicker, type CustomerOpt } from './customer-picker'
import { CatalogPicker, type CatalogOpt } from './catalog-picker'
import { Badge, Button, Input, Select, Textarea } from '@/components/ui/primitives'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { APPROVAL_LABEL, APPROVAL_TONE, CONVERSIONS, DOC_META, STATUS_TONE, UNITS, isTaxDoc, manualStatuses, statusLabel, type SalesType } from '@/lib/sales/docs'
import { VAT_CATEGORIES, amountInWords, computeTotals, fmtMoney, lineAmount } from '@/lib/sales/money'
import {
  archivePdfToVault, convertSalesDoc, createDeliveryNote, deleteSalesDraft, duplicateSalesDoc, logSalesEvent, requestApproval, saveSalesDoc, setSalesStatus, type SalesDocInput,
} from '@/app/actions/sales'
import type { ActionState } from '@/lib/utils'

export type { CustomerOpt, CatalogOpt }
export interface ProjectOpt { id: string; name: string; code: string | null; customer_id: string | null; location: string | null }
export interface TemplateOpt { id: string; name: string; kind: 'terms' | 'payment'; lines: string[]; is_default: boolean }
type Item = PaperItem & { key: string; id?: string | null; materials: string; unit: string; vat_category: string; discount_pct: number | string; catalog_item_id?: string | null; source_item_id?: string | null }
type Head = Omit<SalesDocInput, 'items' | 'terms' | 'payment_terms'> & { termsText: string; paymentText: string }

/** textareas grow with their content (up to a limit, then scroll) instead of hiding text */
const GROW = '[field-sizing:content] min-h-[4.5rem] max-h-72'
const ICON: Record<string, typeof FileText> = { quotation: ScrollText, invoice: Receipt, delivery_note: Truck, credit_note: FileMinus }
const AUTOSAVE_MS = 4000
let seq = 0
const key = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`
const blank = (): Item => ({ key: key(), description: '', materials: '', quantity: 1, unit: 'Nos', unit_price: 0, vat_category: 'standard', discount_pct: 0 })
const uuid = () => crypto.randomUUID()

function ago(ts: number | null, now: number) {
  if (!ts) return null
  const s = Math.max(0, Math.round((now - ts) / 1000))
  return s < 10 ? 'Saved just now' : s < 60 ? `Saved ${Math.floor(s / 5) * 5} seconds ago` : s < 3600 ? `Saved ${Math.floor(s / 60)} min ago` : 'Saved'
}

export function SalesEditor({ doc, items: initialItems, branding, paid, customers, projects, catalog, templates, salespeople, delivery, editable, lockedReason, canStatus, canDelete, canVault, requireApproval }: {
  doc: Record<string, any>; items: (PaperItem & { id?: string })[]; branding: Branding; paid: number; customers: CustomerOpt[]; projects: ProjectOpt[]
  catalog: CatalogOpt[]; templates: TemplateOpt[]; salespeople: { id: string; full_name: string }[]; delivery: Record<string, { ordered: number; delivered: number }>
  editable: boolean; lockedReason?: string | null; canStatus: boolean; canDelete: boolean; canVault: boolean; requireApproval: boolean
}) {
  const t = doc.doc_type as SalesType, meta = DOC_META[t], isTax = isTaxDoc(t), isInv = t === 'invoice', isQtn = t === 'quotation', isDn = t === 'delivery_note', isCn = t === 'credit_note'
  const draft = doc.status === 'draft'
  const [head, setHead] = useState<Head>(() => ({
    customer_id: doc.customer_id, new_customer: false, project_id: doc.project_id, salesperson_id: doc.salesperson_id ?? null,
    issue_date: doc.issue_date, due_date: doc.due_date ?? '', valid_until: doc.valid_until ?? '',
    attention: doc.attention ?? '', customer_name: doc.customer_name ?? '', customer_address: doc.customer_address ?? '', customer_trn: doc.customer_trn ?? '', customer_phone: doc.customer_phone ?? '',
    customer_email: doc.customer_email ?? '', update_customer: false,
    site: doc.site ?? '', subject: doc.subject ?? '', reference: doc.reference ?? '', lpo_ref: doc.lpo_ref ?? '', intro: doc.intro ?? '', closing: doc.closing ?? '',
    receiver_name: doc.receiver_name ?? '', vehicle_no: doc.vehicle_no ?? '', notes: doc.notes ?? '',
    vat_rate: Number(doc.vat_rate ?? 5), discount_type: doc.discount_type ?? 'amount', discount_value: Number(doc.discount_value ?? doc.discount ?? 0),
    show_total: doc.show_total !== false, apply_vat: isQtn ? doc.apply_vat === true : null,
    termsText: (doc.terms ?? []).join('\n'), paymentText: (doc.payment_terms ?? []).join('\n'),
  }))
  const [items, setItems] = useState<Item[]>(() => initialItems.length ? initialItems.map(i => ({ ...i, key: key(), id: i.id ?? null, materials: i.materials ?? '', unit: i.unit ?? 'Nos', vat_category: i.vat_category ?? 'standard', discount_pct: Number(i.discount_pct ?? 0) })) : [blank()])
  const router = useRouter()
  const [dirty, setDirty] = useState(false)
  const [saving, startSave] = useTransition()
  const [busy, startBusy] = useTransition()
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [errors, setErrors] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<Record<string, string | undefined>>({})
  const [savedAt, setSavedAt] = useState<number | null>(null), [now, setNow] = useState(() => Date.now())
  const expected = useRef<string | null>(doc.updated_at ?? null)
  const version = useRef(0)                                   // bumps on every edit → a slow save never marks newer edits as saved
  const tokens = useRef<Record<string, string>>({})          // one idempotency token per action → double clicks create ONE document
  const tok = (k: string) => (tokens.current[k] ??= uuid())
  const [showDelivery, setShowDelivery] = useState(false)

  const touch = () => { version.current++; setDirty(true) }
  const set = <K extends keyof Head>(k: K, v: Head[K]) => { setHead(h => ({ ...h, [k]: v })); touch() }
  const setItem = (i: number, patch: Partial<Item>) => { setItems(xs => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))); touch() }
  const move = (i: number, d: -1 | 1) => { setItems(xs => { const n = [...xs]; const j = i + d; if (j < 0 || j >= n.length) return xs; [n[i], n[j]] = [n[j], n[i]]; return n }); touch() }
  const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean)

  const projectName = projects.find(p => p.id === head.project_id)?.name ?? null
  const paperDocNow = useMemo(() => ({
    project_name: projectName,
    ...doc, ...head, doc_type: t, number: doc.number, due_date: head.due_date || null, valid_until: head.valid_until || null,
    terms: lines(head.termsText), payment_terms: lines(head.paymentText), vat_rate: Number(head.vat_rate) || 0,
  }), [doc, head, t, projectName])
  const paperItemsNow = useMemo(() => items.filter(i => i.description.trim() || Number(i.unit_price) || i === items[0]), [items])
  // typing stays instant: the A4 preview renders from deferred copies and only re-renders when they change (SalesPaper is memoised)
  const paperDoc = useDeferredValue(paperDocNow), paperItems = useDeferredValue(paperItemsNow)
  const tot = computeTotals(paperItems, Number(head.vat_rate) || 0, docDiscount(paperDoc as any), vatOn(paperDoc as any))

  const payload = useCallback((): SalesDocInput => {
    const { termsText, paymentText, ...h } = head
    return {
      ...h, customer_id: h.customer_id || null, project_id: h.project_id || null, salesperson_id: h.salesperson_id || null, terms: lines(termsText), payment_terms: lines(paymentText),
      items: items.filter(i => i.description.trim()).map(({ key: _k, ...i }) => ({ ...i, id: i.id || null, quantity: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0, discount_pct: Number(i.discount_pct) || 0, materials: i.materials || null, vat_category: i.vat_category as any })),
    }
  }, [head, items])

  const save = useCallback((then?: () => void, auto = false) => {
    if (!editable) { then?.(); return }
    const v = version.current
    const sentKeys = items.filter(i => i.description.trim()).map(i => i.key)
    startSave(async () => {
      let r: ActionState
      try { r = await saveSalesDoc(doc.id, payload(), { expected: expected.current, autosave: auto }) }
      catch { r = { error: navigator.onLine ? 'Could not reach the server. Your changes are still on screen — save again in a moment.' : 'You are offline. Your changes are still on screen — save again when you are back online.' } }
      if (r?.error) {
        setErrors(r.error); setFieldErr(r.fieldErrors ?? {})
        if (!auto || r.data?.conflict) toast(r.error, 'error')
        return
      }
      setErrors(null); setFieldErr({})
      if (r?.data?.updatedAt) expected.current = r.data.updatedAt
      // new lines get their database ids, so the next save updates them in place (delivery notes stay linked)
      if (Array.isArray(r?.data?.itemIds)) { const ids = r!.data!.itemIds as string[]; setItems(xs => xs.map(x => { const j = sentKeys.indexOf(x.key); return j >= 0 && ids[j] ? { ...x, id: ids[j] } : x })) }
      if (version.current === v) setDirty(false)              // edits made while saving stay "unsaved"
      setSavedAt(Date.now())
      if (!auto) toast(r?.message === 'Saved.' ? `${meta.label} ${doc.number} saved` : r?.message ?? 'Saved')
      if (r?.data?.customerId) setHead(h => ({ ...h, new_customer: false, customer_id: r.data!.customerId }))
      if (head.new_customer || (r?.data?.revision ?? 0) !== (doc.revision ?? 0) || !auto) router.refresh()
      then?.()
    })
  }, [editable, doc.id, doc.number, doc.revision, payload, items, meta.label, head.new_customer, router])

  // autosave drafts 4 s after the last change (debounced: one request per pause, never per keystroke). Sent documents save manually → revisions.
  useEffect(() => {
    if (!dirty || !editable || !draft || saving || errors) return
    const h = setTimeout(() => save(undefined, true), AUTOSAVE_MS)
    return () => clearTimeout(h)
  }, [dirty, editable, draft, saving, errors, head, items, save])
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(i) }, [])

  // Ctrl/Cmd+S saves; warn before closing / refreshing / navigating away with unsaved changes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save() } }
    const onLeave = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    const onClick = (e: MouseEvent) => {
      if (!dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download') || !/^https?:/.test(a.href)) return
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin || url.pathname === location.pathname) return
      if (!window.confirm('You have unsaved changes.\n\nLeave without saving?')) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey); window.addEventListener('beforeunload', onLeave); document.addEventListener('click', onClick, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave); document.removeEventListener('click', onClick, true) }
  }, [dirty, save])

  const run = (fn: () => Promise<ActionState>, opts: { confirm?: string; saveFirst?: boolean } = {}) => {
    if (opts.confirm && !window.confirm(opts.confirm)) return
    const go = () => startBusy(async () => {
      const r = await fn()
      if (r?.error) toast(r.error, 'error'); else if (r?.message) toast(r.message)
    })
    if (opts.saveFirst && dirty) save(go); else go()
  }
  // picking a customer copies their details into THIS document; edits here never change the customer record unless “update” is ticked
  const pickCustomer = (cu: CustomerOpt | null) => {
    setHead(h => cu ? { ...h, customer_id: cu.id, new_customer: false, update_customer: false, customer_name: cu.name, customer_address: cu.address ?? '', customer_trn: cu.trn ?? '', customer_phone: cu.phone ?? '', customer_email: cu.email ?? '', attention: cu.contact_person ?? h.attention }
      : { ...h, customer_id: null, update_customer: false })
    touch()
  }
  const pickProject = (id: string) => {
    const p = projects.find(x => x.id === id)
    setHead(h => ({ ...h, project_id: id || null, site: p?.location && !h.site ? p.location : h.site }))
    if (p?.customer_id && !head.customer_id) pickCustomer(customers.find(c => c.id === p.customer_id) ?? null)
    touch()
  }
  const addFromCatalog = (c: CatalogOpt) => {
    const it: Item = { key: key(), description: [c.name, c.description].filter(Boolean).join('\n'), materials: '', quantity: 1, unit: c.unit || 'Nos', unit_price: c.rate, vat_category: c.vat_category, discount_pct: 0, catalog_item_id: c.id }
    setItems(xs => (xs.length === 1 && !xs[0].description.trim() && !Number(xs[0].unit_price) ? [it] : [...xs, it])); touch()
  }
  const applyTemplate = (kind: 'terms' | 'payment', id: string) => {
    const tpl = templates.find(x => x.id === id); if (!tpl) return
    const cur = kind === 'terms' ? head.termsText : head.paymentText
    if (cur.trim() && !window.confirm(`Replace the current ${kind === 'terms' ? 'terms and conditions' : 'payment terms'} with “${tpl.name}”?`)) return
    set(kind === 'terms' ? 'termsText' : 'paymentText', tpl.lines.join('\n'))
  }
  const customer = customers.find(c => c.id === head.customer_id)
  const amountTxt = meta.priced ? ` for AED ${fmtMoney(tot.total)}` : ''
  const mail = `mailto:${encodeURIComponent(head.customer_email || customer?.email || '')}?subject=${encodeURIComponent(`${meta.label} ${doc.number}${head.subject ? ' — ' + head.subject : ''}`)}&body=${encodeURIComponent(
    `Dear ${head.attention || 'Sir/Madam'},\n\nPlease find attached our ${meta.label.toLowerCase()} ${doc.number}${amountTxt}.\n\nKind regards,\n${branding.companyName}`)}`
  const waPhone = (head.customer_phone || customer?.phone || '').replace(/[^\d]/g, '').replace(/^00/, '').replace(/^0(5\d{8})$/, '971$1').replace(/^(5\d{8})$/, '971$1')
  const wa = `https://wa.me/${waPhone}?text=${encodeURIComponent(`Dear ${head.attention || 'Sir/Madam'}, please find our ${meta.label.toLowerCase()} ${doc.number}${amountTxt}. The PDF follows in this chat. — ${branding.companyName}`)}`
  const Icon = ICON[t] ?? FileText
  const statuses = canStatus ? manualStatuses(t, doc.status) : []
  const err = (k: string) => fieldErr[k] ? <span role="alert" className="text-[11px] text-danger">{fieldErr[k]}</span> : null
  const openPrint = () => { void logSalesEvent(doc.id, 'printed'); window.open(`/print/sales/${doc.id}?auto=1`, '_blank') }
  const download = () => { location.href = `/api/sales/${doc.id}/pdf` }
  const status = editable ? (saving ? 'Saving…' : dirty ? (draft ? 'Unsaved changes · autosaves in a moment' : 'Unsaved changes · Ctrl+S saves a new revision') : ago(savedAt, now) ?? 'All changes saved') : (lockedReason ?? 'Read only')
  const termsTpl = templates.filter(x => x.kind === 'terms'), payTpl = templates.filter(x => x.kind === 'payment')
  const canDeliver = isQtn && canStatus && !['cancelled', 'rejected'].includes(doc.status) && Object.values(delivery).some(d => d.ordered - d.delivered > 0)
  const approval = doc.approval_status as string | null

  return <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
    {/* toolbar */}
    <div className="no-print sticky top-14 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-surface/90 px-4 py-2.5 backdrop-blur sm:px-6">
      <Link href="/invoices" aria-label="Back to sales documents" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"><ArrowLeft size={17} /></Link>
      <span className="hidden rounded-md bg-primary-soft p-1.5 text-primary sm:inline-flex"><Icon size={16} aria-hidden /></span>
      <div className="min-w-0 leading-tight">
        <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-sm font-semibold">{meta.label} {doc.number}{doc.revision ? <span className="ms-1 text-muted">Rev.{doc.revision}</span> : null}</h1>
          <Badge tone={STATUS_TONE[doc.status]}>{statusLabel(t, doc.status)}</Badge>{approval && <Badge tone={APPROVAL_TONE[approval]}>{APPROVAL_LABEL[approval]}</Badge>}</div>
        <div className={cn('text-[11px]', errors && editable ? 'text-danger' : 'text-muted')} aria-live="polite" data-testid="save-status">{errors && editable && !saving ? 'Not saved — see the message below' : status}</div>
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-1.5">
        <div className="flex rounded-md border border-border p-0.5 lg:hidden" role="tablist" aria-label="Editor view">
          {(['edit', 'preview'] as const).map(v => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn('flex min-h-8 cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-xs font-medium capitalize', view === v ? 'bg-primary text-primary-fg' : 'text-muted')}>{v === 'edit' ? <PenLine size={13} /> : <Eye size={13} />}{v}</button>)}
        </div>
        {editable && <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save</Button>}
        <Button size="sm" variant="secondary" onClick={() => (dirty ? save(openPrint) : openPrint())}><Printer size={14} /><span className="hidden sm:inline">Print</span></Button>
        <Button size="sm" variant="secondary" onClick={() => (dirty ? save(download) : download())}><Download size={14} /><span className="hidden sm:inline">PDF</span></Button>
        <Menu label={<><MoreHorizontal size={15} /><span className="sr-only">More actions</span></>} busy={busy}>
          {canVault && <MenuItem icon={FolderArchive} onClick={() => run(() => archivePdfToVault(doc.id), { saveFirst: true })}>Save PDF to Document Vault</MenuItem>}
          <MenuItem icon={Mail} href={mail} onClick={() => void logSalesEvent(doc.id, 'emailed')}>Email to customer…</MenuItem>
          {waPhone.length >= 9 && <MenuItem icon={MessageCircle} href={wa} external onClick={() => void logSalesEvent(doc.id, 'whatsapp')}>Share on WhatsApp…</MenuItem>}
          {isQtn && requireApproval && canStatus && (!approval || approval === 'changes_requested' || approval === 'rejected') && <MenuItem icon={Send} onClick={() => run(() => requestApproval(doc.id), { saveFirst: true })}>Request approval</MenuItem>}
          {canDeliver && <MenuItem icon={Truck} onClick={() => (dirty ? save(() => setShowDelivery(true)) : setShowDelivery(true))}>Create delivery note (choose quantities)…</MenuItem>}
          {canStatus && (CONVERSIONS[t] ?? []).filter(to => !(isQtn && to === 'delivery_note')).filter(to => to !== 'credit_note' || !draft).map(to => <MenuItem key={to} icon={to === 'credit_note' ? FileMinus : Repeat}
            onClick={() => run(() => convertSalesDoc(doc.id, to, tok(`convert-${to}`)), { saveFirst: true })}>{isQtn && to === 'invoice' ? 'Convert to invoice' : `Create ${DOC_META[to].label.toLowerCase()}`}</MenuItem>)}
          {canStatus && !isCn && <MenuItem icon={Copy} onClick={() => run(() => duplicateSalesDoc(doc.id, tok('duplicate')), { saveFirst: true })}>Duplicate</MenuItem>}
          {statuses.length > 0 && <div className="my-1 border-t border-border" role="separator" />}
          {statuses.map(s => <MenuItem key={s} icon={s === 'cancelled' ? X : CheckCircle2} danger={s === 'cancelled'}
            onClick={() => run(() => setSalesStatus(doc.id, s), { saveFirst: true, confirm: s === 'cancelled' ? `Cancel ${doc.number}? It stays on record but can no longer be edited.` : isCn && s === 'sent' ? `Issue credit note ${doc.number}? It reduces the invoice balance and can no longer be edited.` : undefined })}>
            {isTax && s === 'sent' ? `Issue ${meta.label.toLowerCase()}` : s === 'viewed' ? 'Mark as viewed (customer confirmed)' : `Mark as ${statusLabel(t, s).toLowerCase()}`}</MenuItem>)}
          {canDelete && ['draft', 'cancelled'].includes(doc.status) && <><div className="my-1 border-t border-border" role="separator" />
            <MenuItem icon={Trash2} danger onClick={() => run(() => deleteSalesDraft(doc.id), { confirm: `Move ${doc.number} to the trash? An admin can restore it from Settings → Trash.` })}>Move to trash</MenuItem></>}
        </Menu>
      </div>
    </div>

    {showDelivery && <DeliveryDialog items={items} delivery={delivery} onClose={() => setShowDelivery(false)} onCreate={l => run(() => createDeliveryNote(doc.id, l, tok('dn-' + JSON.stringify(l))))} busy={busy} />}

    <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(380px,520px)_1fr]">
      {/* ── editor ── */}
      <div className={cn('flex min-w-0 flex-col gap-4', view === 'preview' && 'hidden lg:flex')}>
        {errors && <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{errors}</div>}
        {!editable && lockedReason && <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">{lockedReason}</div>}
        {approval && doc.approval_note && <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm"><b>{APPROVAL_LABEL[approval]}:</b> {doc.approval_note}</div>}
        <fieldset disabled={!editable} className="contents">
          <Section icon={Building2} title={isDn ? 'Customer & delivery' : 'Customer'} sub={`${meta.label} recipient`}>
            <F label="Customer">
              <CustomerPicker customers={customers} value={head.customer_id} onPick={pickCustomer} disabled={!editable} />
            </F>
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Customer / company name" error={err('customer_name')}><Input value={head.customer_name ?? ''} onChange={e => set('customer_name', e.target.value)} placeholder="e.g. ABC Contracting LLC" /></F>
              <F label={isQtn ? 'Attention (contact name)' : 'Contact person'}><Input value={head.attention ?? ''} onChange={e => set('attention', e.target.value)} placeholder="e.g. Mr. Ahmed" /></F>
            </div>
            {customer && (customer.name !== head.customer_name || (customer.address ?? '') !== (head.customer_address ?? '') || (customer.trn ?? '') !== (head.customer_trn ?? '') || (customer.phone ?? '') !== (head.customer_phone ?? '') || (customer.email ?? '') !== (head.customer_email ?? '') || (customer.contact_person ?? '') !== (head.attention ?? '')) &&
              <label className="flex cursor-pointer items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm"><input type="checkbox" checked={!!head.update_customer} onChange={e => set('update_customer', e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                <span>These details differ from the saved customer. They are used for <b>this document only</b> — tick <b>Update customer profile</b> to also change “{customer.name}” in Clients.</span></label>}
            {!head.customer_id && head.customer_name && <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={!!head.new_customer} onChange={e => set('new_customer', e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />Save “{head.customer_name}” as a customer</label>}
            <F label="Address" hint="Use separate lines for building, street, area, city — they print the same way"><Textarea rows={3} className={GROW} value={head.customer_address ?? ''} onChange={e => set('customer_address', e.target.value)} placeholder={'e.g. Office 12, Al Saqr Building\nMusaffah M-44\nAbu Dhabi, UAE'} /></F>
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Customer TRN" hint={isQtn ? 'Optional on quotations · 15 digits' : '15 digits'} error={err('customer_trn')}><Input inputMode="numeric" value={head.customer_trn ?? ''} onChange={e => set('customer_trn', e.target.value)} placeholder="100xxxxxxxxxxxx" aria-invalid={!!fieldErr.customer_trn} /></F>
              <F label="Phone" error={err('customer_phone')}><Input type="tel" value={head.customer_phone ?? ''} onChange={e => set('customer_phone', e.target.value)} placeholder="+971 …" aria-invalid={!!fieldErr.customer_phone} /></F>
              <F label="Email" error={err('customer_email')}><Input type="email" value={head.customer_email ?? ''} onChange={e => set('customer_email', e.target.value)} placeholder="name@company.com" aria-invalid={!!fieldErr.customer_email} /></F>
              <F label={isDn ? 'Delivery to' : 'Working place / site'}><Input value={head.site ?? ''} onChange={e => set('site', e.target.value)} placeholder="e.g. Villa 22, Fujairah" /></F>
            </div>
          </Section>

          <Section icon={Icon} title={`${meta.label} details`} sub="Number, dates and references">
            <div className="grid gap-3 sm:grid-cols-2">
              <F label={`${meta.label} no.`} hint="Assigned automatically — never duplicated"><Input value={`${doc.number}${doc.revision ? `  ·  Rev.${doc.revision}` : ''}`} readOnly className="bg-surface-2 font-mono" /></F>
              <F label="Date" error={err('issue_date')}><Input type="date" value={head.issue_date} onChange={e => set('issue_date', e.target.value)} required /></F>
              {isInv && <F label="Due date" error={err('due_date')}><Input type="date" value={head.due_date ?? ''} min={head.issue_date} onChange={e => set('due_date', e.target.value)} aria-invalid={!!fieldErr.due_date} /></F>}
              {isQtn && <F label="Valid until" error={err('valid_until')}><Input type="date" value={head.valid_until ?? ''} min={head.issue_date} onChange={e => set('valid_until', e.target.value)} aria-invalid={!!fieldErr.valid_until} /></F>}
              {!isQtn && <F label="L.P.O. / PO ref."><Input value={head.lpo_ref ?? ''} onChange={e => set('lpo_ref', e.target.value)} /></F>}
              <F label="Your reference"><Input value={head.reference ?? ''} onChange={e => set('reference', e.target.value)} placeholder="Customer enquiry / RFQ no." /></F>
              <F label="Project">
                <Select value={head.project_id ?? ''} onChange={e => pickProject(e.target.value)}>
                  <option value="">— No project —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}
                </Select>
              </F>
              <F label="Salesperson">
                <Select value={head.salesperson_id ?? ''} onChange={e => set('salesperson_id', e.target.value || null)}>
                  <option value="">—</option>{salespeople.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
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
                  {isQtn && it.id && (delivery[it.id]?.delivered ?? 0) > 0 && <Badge tone={delivery[it.id].delivered >= delivery[it.id].ordered ? 'green' : 'amber'}>Delivered {delivery[it.id].delivered} / {delivery[it.id].ordered}</Badge>}
                  {editable && <div className="ms-auto flex items-center gap-0.5">
                    <IconBtn label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={14} /></IconBtn>
                    <IconBtn label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDown size={14} /></IconBtn>
                    <IconBtn label="Duplicate line" onClick={() => { setItems(xs => [...xs.slice(0, i + 1), { ...it, key: key(), id: null, source_item_id: null }, ...xs.slice(i + 1)]); touch() }}><Copy size={14} /></IconBtn>
                    <IconBtn label="Remove line" danger onClick={() => { setItems(xs => xs.length > 1 ? xs.filter((_, j) => j !== i) : [blank()]); touch() }}><Trash2 size={14} /></IconBtn>
                  </div>}
                </div>
                <Textarea aria-label={`Line ${i + 1} description`} rows={2} className={GROW} value={it.description} onChange={e => setItem(i, { description: e.target.value })} placeholder="e.g. Supply and installation of steel staircase with handrail" aria-invalid={!!fieldErr[`items.${i}.description`]} />
                {err(`items.${i}.description`)}
                {isQtn && <Input aria-label={`Line ${i + 1} materials`} className="mt-2" value={it.materials} onChange={e => setItem(i, { materials: e.target.value })} placeholder="Materials to be used (optional)" />}
                <div className={cn('mt-2 grid gap-2', meta.priced ? 'grid-cols-[1fr_1fr_1.3fr]' : 'grid-cols-2')}>
                  <F label="Qty" small error={err(`items.${i}.quantity`)}><Input type="number" min={0} step="any" inputMode="decimal" value={it.quantity} onChange={e => setItem(i, { quantity: e.target.value })} /></F>
                  <F label="Unit" small><Select value={it.unit} onChange={e => setItem(i, { unit: e.target.value })}>{[...new Set([...UNITS, it.unit])].map(u => <option key={u}>{u}</option>)}</Select></F>
                  {meta.priced && <F label="Rate (AED)" small error={err(`items.${i}.unit_price`)}><Input type="number" min={0} step="0.01" inputMode="decimal" value={it.unit_price} onChange={e => setItem(i, { unit_price: e.target.value })} /></F>}
                </div>
                {meta.priced && <div className="mt-2 grid grid-cols-[1fr_1.3fr] gap-2">
                  <F label="Line discount %" small error={err(`items.${i}.discount_pct`)}><Input type="number" min={0} max={100} step="0.01" inputMode="decimal" value={it.discount_pct} onChange={e => setItem(i, { discount_pct: e.target.value })} /></F>
                  <F label="VAT" small><Select value={it.vat_category} onChange={e => setItem(i, { vat_category: e.target.value })}>{Object.entries(VAT_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{k === 'standard' ? `Standard ${head.vat_rate}%` : l}</option>)}</Select></F>
                </div>}
              </li>)}
            </ol>
            {editable && <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="secondary" className="flex-1 border-dashed" onClick={() => { setItems(xs => [...xs, blank()]); touch() }}><Plus size={15} />Add line</Button>
              <CatalogPicker items={catalog} onPick={addFromCatalog} priced={meta.priced} />
            </div>}
          </Section>

          {meta.priced && <Section icon={Receipt} title="Totals" sub={isTax ? 'VAT on standard-rated lines, after discount' : head.apply_vat ? 'VAT is added to this quotation' : 'VAT is noted, not added, on this quotation'}>
            <div className="grid gap-3 sm:grid-cols-3">
              <F label="VAT rate (%)" error={err('vat_rate')}><Input type="number" min={0} max={100} step="0.01" value={head.vat_rate as number} onChange={e => set('vat_rate', e.target.value as any)} /></F>
              <F label="Discount type"><Select value={head.discount_type ?? 'amount'} onChange={e => set('discount_type', e.target.value as any)}><option value="amount">Fixed (AED)</option><option value="percent">Percentage (%)</option></Select></F>
              <F label={head.discount_type === 'percent' ? 'Discount (%)' : 'Discount (AED)'} error={err('discount_value')}><Input type="number" min={0} max={head.discount_type === 'percent' ? 100 : undefined} step="0.01" value={head.discount_value as number} onChange={e => set('discount_value', e.target.value as any)} /></F>
            </div>
            {isQtn && <div className="flex flex-col gap-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={!!head.apply_vat} onChange={e => set('apply_vat', e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />Add VAT to this quotation (show VAT and grand total)</label>
              <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={!!head.show_total} onChange={e => set('show_total', e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />Show the total rows on the quotation</label>
            </div>}
            <dl className="rounded-lg bg-surface-2/60 p-3 text-sm tabular-nums" data-testid="totals">
              <Row k="Subtotal" v={fmtMoney(tot.subtotal)} />
              {tot.discount > 0 && <Row k={`Discount${head.discount_type === 'percent' ? ` ${Number(head.discount_value)}%` : ''}`} v={`− ${fmtMoney(tot.discount)}`} />}
              {vatOn(paperDoc as any) && <Row k={`VAT ${head.vat_rate}%${tot.zeroBase || tot.exemptBase ? ` on ${fmtMoney(tot.standardBase)}` : ''}`} v={fmtMoney(tot.vat)} />}
              <Row k={vatOn(paperDoc as any) ? 'Grand total' : 'Total'} v={`AED ${fmtMoney(tot.total)}`} strong />
              {isInv && paid > 0 && <><Row k="Paid" v={fmtMoney(paid)} /><Row k="Balance" v={`AED ${fmtMoney(tot.total - paid)}`} strong /></>}
              <p className="mt-2 text-xs text-muted">{amountInWords(tot.total)}</p>
            </dl>
          </Section>}

          {(isQtn || isInv) && <Section icon={ScrollText} title={isQtn ? 'Letter & terms' : 'Terms'} sub="Pick a template (Settings → Document templates) and edit it for this document" collapsed={!isQtn}>
            {isQtn && <F label="Opening"><Textarea rows={3} className={GROW} value={head.intro ?? ''} onChange={e => set('intro', e.target.value)} /></F>}
            {isQtn && <F label="Closing note"><Textarea rows={3} className={GROW} value={head.closing ?? ''} onChange={e => set('closing', e.target.value)} /></F>}
            {isQtn && <F label="Terms and conditions" hint="One clause per line — they are numbered automatically">
              {termsTpl.length > 0 && <Select aria-label="Terms template" value="" onChange={e => applyTemplate('terms', e.target.value)}><option value="">Insert a terms template…</option>{termsTpl.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}
              <Textarea rows={3} className={GROW} value={head.termsText} onChange={e => set('termsText', e.target.value)} /></F>}
            <F label="Payment terms" hint="One per line">
              {payTpl.length > 0 && <Select aria-label="Payment terms template" value="" onChange={e => applyTemplate('payment', e.target.value)}><option value="">Insert a payment-terms template…</option>{payTpl.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}
              <Textarea rows={3} className={GROW} value={head.paymentText} onChange={e => set('paymentText', e.target.value)} /></F>
          </Section>}

          <Section icon={PenLine} title="Internal notes" sub="Never printed" collapsed={!head.notes}>
            <Textarea rows={3} value={head.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Notes for your team only" />
          </Section>
        </fieldset>
      </div>

      {/* ── live preview ── */}
      <div className={cn('min-w-0', view === 'edit' && 'hidden lg:block')}>
        <div className="sticky top-32">
          <div className="mb-2 flex items-center justify-between text-xs text-muted"><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />Live A4 preview</span><span>Same layout as Print → Save as PDF</span></div>
          <div className="rounded-xl bg-[repeating-linear-gradient(45deg,hsl(var(--surface-2)),hsl(var(--surface-2))_10px,hsl(var(--bg))_10px,hsl(var(--bg))_20px)] p-3 sm:p-5">
            <FitPaper><SalesPaper doc={paperDoc as any} items={paperItems} branding={branding} paid={paid} pageGuides /></FitPaper>
          </div>
        </div>
      </div>
    </div>
  </div>
}

/** Quotation → delivery note: choose how much of each line is delivered now (partial delivery). */
function DeliveryDialog({ items, delivery, onClose, onCreate, busy }: { items: Item[]; delivery: Record<string, { ordered: number; delivered: number }>; onClose: () => void; onCreate: (l: { item_id: string; qty: number }[]) => void; busy: boolean }) {
  const rows = items.filter(i => i.id && delivery[i.id]).map(i => ({ ...i, ...delivery[i.id!], left: Math.max(0, delivery[i.id!].ordered - delivery[i.id!].delivered) }))
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(r => [r.id!, String(r.left)])))
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const bad = rows.find(r => Number(qty[r.id!]) > r.left + 1e-9 || Number(qty[r.id!]) < 0)
  return <dialog ref={ref} onClose={onClose} aria-labelledby="dn-title" className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/40">
    <div className="flex items-center justify-between border-b border-border px-5 py-3"><h2 id="dn-title" className="font-semibold">Create delivery note</h2><button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-1 text-muted hover:bg-surface-2"><X size={16} /></button></div>
    <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
      <p className="mb-3 text-sm text-muted">Enter the quantity delivered now. Remaining quantities stay open for the next delivery.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1.5 pe-2 font-medium">Item</th><th className="px-2 text-right font-medium">Ordered</th><th className="px-2 text-right font-medium">Delivered</th><th className="px-2 text-right font-medium">Remaining</th><th className="ps-2 text-right font-medium">Deliver now</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map(r => <tr key={r.id}>
          <td className="max-w-[16rem] py-2 pe-2"><span className="line-clamp-2">{r.description}</span></td>
          <td className="px-2 text-right tabular-nums">{r.ordered} {r.unit}</td><td className="px-2 text-right tabular-nums">{r.delivered}</td><td className="px-2 text-right font-medium tabular-nums">{r.left}</td>
          <td className="ps-2"><Input type="number" min={0} max={r.left} step="any" inputMode="decimal" aria-label={`Deliver now: ${r.description.slice(0, 40)}`} value={qty[r.id!]} onChange={e => setQty(q => ({ ...q, [r.id!]: e.target.value }))} className="ms-auto w-24 text-right" aria-invalid={Number(qty[r.id!]) > r.left} /></td></tr>)}</tbody></table></div>
      {!rows.length && <p className="text-sm text-muted">Save the quotation first — lines need to be saved before they can be delivered.</p>}
      {bad && <p role="alert" className="mt-3 text-sm text-danger">“{bad.description.slice(0, 40)}”: you can deliver at most {bad.left}.</p>}
    </div>
    <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
      <Button variant="secondary" onClick={() => ref.current?.close()}>Cancel</Button>
      <Button disabled={busy || !!bad || !rows.some(r => Number(qty[r.id!]) > 0)} onClick={() => onCreate(rows.map(r => ({ item_id: r.id!, qty: Number(qty[r.id!]) || 0 })))}>{busy && <Loader2 size={14} className="animate-spin" />}Create delivery note</Button>
    </div>
  </dialog>
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
function F({ label, hint, children, className, small, error }: { label: string; hint?: string; children: ReactNode; className?: string; small?: boolean; error?: ReactNode }) {
  return <label className={cn('flex min-w-0 flex-col gap-1', className)}><span className={cn('font-medium', small ? 'text-[11px] text-muted' : 'text-xs')}>{label}</span>{children}{error ?? (hint && <span className="text-[11px] text-muted">{hint}</span>)}</label>
}
function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={cn('flex justify-between gap-3 py-0.5', strong && 'mt-1 border-t border-border pt-1.5 font-semibold')}><dt className={strong ? '' : 'text-muted'}>{k}</dt><dd>{v}</dd></div>
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
    {open && <div role="menu" className="toast-in absolute end-0 top-full z-30 mt-1 max-h-[70vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-xl">{children}</div>}
  </div>
}
function MenuItem({ icon: Icon, children, onClick, href, danger, external }: { icon: typeof FileText; children: ReactNode; onClick?: () => void; href?: string; danger?: boolean; external?: boolean }) {
  const cls = cn('flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm hover:bg-surface-2', danger && 'text-danger')
  return href ? <a role="menuitem" href={href} onClick={onClick} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className={cls}><Icon size={15} aria-hidden />{children}</a>
    : <button role="menuitem" type="button" onClick={onClick} className={cls}><Icon size={15} aria-hidden />{children}</button>
}
