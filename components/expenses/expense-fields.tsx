'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AccountSelect } from '@/components/banking/account-select'
import { AlertTriangle, Camera, CheckCircle2, Loader2, Plus, ScanText, Trash2, Upload } from '@/components/icons'
import { Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { EXPENSE_CATS, PAYMENT_METHODS } from '@/lib/projects'
import { cn } from '@/lib/utils'
import { shrinkForScan, warmScan } from '@/lib/expenses/scan-turbo'
import type { ReceiptLine, ReceiptRead } from '@/lib/expenses/receipt-read'

type Opt = { id: string; name: string }
export type SupplierOpt = { id: string; name: string; trn?: string | null }
const READERS: Record<string, string> = { paddleocr: 'PaddleOCR on this server, free', tesseract: 'local OCR on this server, free', text_layer: 'the PDF text, free', google_vision: 'Google Vision', ocrspace: 'OCR.Space', gemini: 'Google AI' }
/** Who read the receipt, in words: e.g. "PaddleOCR on this server, free + Google AI (photo)". */
const readBy = (r: { provider: string | null; engine: string; aiSaw?: 'photo' | 'text' | null }) => {
  const ocr = r.provider === 'gemini' ? 'Google AI (photo)' : READERS[r.provider ?? ''] ?? 'OCR'
  return r.engine === 'rules+gemini' && r.provider !== 'gemini' ? `${ocr} + Google AI${r.aiSaw === 'photo' ? ' (photo)' : ''}` : ocr
}
export type ScanResult = { read: ReceiptRead; provider: string | null; engine: string; aiSaw?: 'photo' | 'text' | null; aiNote?: string | null; cached?: boolean; bytes?: number; supplier: { id: string; name: string; trn: string | null } | null; duplicate: { id: string; spent_on: string; amount: number; vat_amount: number; reference: string } | null }
type Line = { description: string; quantity: string; unit_price: string; amount: string }

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (s: string) => { const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }
const RATES: [string, string][] = [['5', '5% standard'], ['0', '0% / exempt'], ['custom', 'Other amount']]

/**
 * Expense / supplier purchase form. A receipt can be photographed (phone camera) or uploaded (image or PDF); it is read
 * at once and the fields are FILLED AS SUGGESTIONS (tinted), with any warnings and a possible duplicate shown.
 * A scanned expense saves only after "I checked these details against the receipt" is ticked; the receipt file is kept
 * with the expense. Field names match the save action (and the older form) so every page using it keeps working.
 */
export function ExpenseFields({ e, today, projects, assets, employees, suppliers, fixedProject, initialFile, claim }: {
  e?: Record<string, any>; today: string; projects?: Opt[]; assets?: Opt[]; employees: Opt[]; suppliers: (string | SupplierOpt)[]; fixedProject?: boolean
  /** a receipt picked before the form opened (the "Scan receipt" button): read immediately */
  initialFile?: File | null
  /** an employee's expense claim (Employee Portal): only what the employee knows; payment account, project and links are
   *  chosen by the approver */
  claim?: boolean
}) {
  const box = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null)
  const sups = useMemo(() => suppliers.map(s => typeof s === 'string' ? { id: '', name: s, trn: null as string | null } : { ...s, trn: s.trn ?? null }), [suppliers])
  const [scan, setScan] = useState<{ busy: boolean; result?: ScanResult; err?: string; file?: string; stage?: 'local' | 'cloud' | 'ai'; final?: boolean }>({ busy: false })
  const [preview, setPreview] = useState<string | null>(null)
  const [supplier, setSupplier] = useState<string>(e?.supplier_name ?? '')
  const [trn, setTrn] = useState<string>(e?.supplier_trn ?? '')
  const [amount, setAmount] = useState<string>(e?.amount != null ? String(e.amount) : '')
  const initRate = e ? (Number(e.vat_amount) === 0 ? '0' : e.amount && Math.abs(Number(e.vat_amount) - Number(e.amount) * 0.05) < 0.011 ? '5' : 'custom') : '5'
  const [rate, setRate] = useState(initRate)
  const [vat, setVat] = useState<string>(e?.vat_amount != null ? String(e.vat_amount) : '')
  const [status, setStatus] = useState<'paid' | 'unpaid'>(e?.payment_status ?? 'paid')
  const [lines, setLines] = useState<Line[]>(() => (Array.isArray(e?.items) ? e!.items : []).map((l: ReceiptLine) => ({ description: l.description, quantity: l.quantity == null ? '' : String(l.quantity), unit_price: l.unit_price == null ? '' : String(l.unit_price), amount: String(l.amount) })))
  const [showLines, setShowLines] = useState(lines.length > 0)
  const known = sups.find(s => s.name.toLowerCase() === supplier.trim().toLowerCase())
  const vatNum = rate === '5' ? r2(num(amount) * 0.05) : rate === '0' ? 0 : num(vat)
  const total = r2(num(amount) + vatNum)
  const scanned = !!scan.result
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  // What the scan put into each field. When a later, better reading arrives (a paid reader double-checked the free one),
  // a field is only updated if it still holds what the scan put there: anything the person changed meanwhile is kept.
  type Filled = Partial<Record<'spent_on' | 'reference' | 'description' | 'quantity', string>> & { supplier?: string; trn?: string; amount?: string; rate?: string; vat?: string; lines?: Line[] }
  const run = useRef(0)
  const fill = (form: HTMLFormElement, res: ScanResult, prev?: Filled): Filled => {
    const g = res.read, next: Filled = {}
    const dom = (n: 'spent_on' | 'reference' | 'description' | 'quantity', v: unknown) => {
      if (v === undefined || v === null || v === '') return
      const el = form.elements.namedItem(n) as HTMLInputElement | null; if (!el) return
      if (prev && el.value !== (prev[n] ?? el.value)) { next[n] = prev[n]; return }       // changed by the person: keep
      el.value = String(v); el.dataset.suggested = '1'; next[n] = String(v)
    }
    dom('spent_on', g.date); dom('reference', g.invoice_no)
    dom('description', g.lines.length === 1 ? g.lines[0].description : g.lines.length > 1 ? `${g.lines[0].description} + ${g.lines.length - 1} more item${g.lines.length > 2 ? 's' : ''}` : g.supplier ? `Purchase from ${res.supplier?.name ?? g.supplier}` : undefined)
    if (g.lines.length === 1 && g.lines[0].quantity) dom('quantity', g.lines[0].quantity)
    const keep = <T,>(cur: T, was: T | undefined, v: T) => (prev && was !== undefined && JSON.stringify(cur) !== JSON.stringify(was) ? cur : v)
    next.supplier = res.supplier?.name ?? g.supplier ?? ''; setSupplier(cur => keep(cur, prev?.supplier, next.supplier!))
    next.trn = g.trn ?? res.supplier?.trn ?? ''; setTrn(cur => keep(cur, prev?.trn, next.trn!))
    if (g.subtotal !== undefined) { next.amount = g.subtotal.toFixed(2); setAmount(cur => keep(cur, prev?.amount, next.amount!)) }
    if (g.vat !== undefined) {
      const sub = g.subtotal ?? 0
      next.rate = g.vat === 0 ? '0' : sub && Math.abs(g.vat - sub * 0.05) < 0.011 ? '5' : 'custom'
      setRate(cur => keep(cur, prev?.rate, next.rate!))
      if (next.rate === 'custom') { next.vat = g.vat.toFixed(2); setVat(cur => keep(cur, prev?.vat, next.vat!)) }
    }
    next.lines = g.lines.map(l => ({ description: l.description, quantity: l.quantity == null ? '' : String(l.quantity), unit_price: l.unit_price == null ? '' : String(l.unit_price), amount: l.amount.toFixed(2) }))
    setLines(cur => keep(cur, prev?.lines, next.lines!)); if (!prev) setShowLines(g.lines.length > 1); else if (next.lines.length > 1) setShowLines(true)
    return next
  }

  const read = async (file: File) => {
    const form = box.current?.closest('form'); if (!form) return
    const id = ++run.current, current = () => run.current === id     // a newer photo replaces this reading
    setScan({ busy: true, file: file.name, stage: 'local' })
    setPreview(p => { if (p) URL.revokeObjectURL(p); return file.type.startsWith('image/') ? URL.createObjectURL(file) : null })   // the photo shows at once
    const fail = (err: string) => { if (current()) setScan(s => s.result ? { ...s, busy: false, final: true, result: { ...s.result, aiNote: err } } : { busy: false, err, file: file.name }) }
    try {
      const send = await shrinkForScan(file)                      // turbo: a smaller copy is read; the original is what gets saved
      const fd = new FormData(); fd.append('file', send, send.name)
      const r = await fetch('/api/expenses/scan', { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' } })
      if (!r.ok || !r.body || !(r.headers.get('content-type') ?? '').includes('ndjson')) { const j = await r.json().catch(() => ({})); fail(j.error ?? 'The receipt could not be read. Enter the details by hand.'); return }
      // one JSON object per line: stage → (partial) → final | error
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', filled: Filled | undefined, ended = false
      const handle = (m: { type: string; stage?: 'local' | 'cloud' | 'ai'; error?: string } & Partial<ScanResult>) => {
        if (!current()) return
        if (m.type === 'stage') setScan(s => ({ ...s, stage: m.stage }))
        else if (m.type === 'partial' || m.type === 'final') {
          const res = m as unknown as ScanResult
          filled = fill(form, res, filled)
          setScan(s => ({ busy: m.type === 'partial', final: m.type === 'final', result: res, file: file.name, stage: s.stage }))
          if (m.type === 'final') ended = true
        } else if (m.type === 'error') { ended = true; fail(m.error ?? 'The receipt could not be read.') }
      }
      for (;;) {
        const { value, done } = await reader.read()
        if (value) { buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(JSON.parse(line)) } }
        if (done) break
      }
      if (buf.trim()) handle(JSON.parse(buf))
      if (!ended) fail('The connection dropped before the reading finished. The fields filled so far are kept; check them, or try again.')
    } catch { fail('Network problem while reading the receipt. Try again, or enter the details by hand.') }
  }
  const attach = (f: File | null | undefined) => {
    if (!f || !fileRef.current) return
    const dt = new DataTransfer(); dt.items.add(f); fileRef.current.files = dt.files
    void read(f)
  }
  useEffect(() => { if (initialFile) attach(initialFile) }, [initialFile])   // eslint-disable-line react-hooks/exhaustive-deps

  const c = scan.result?.read.confidence ?? {}
  const sure = (k: keyof ReceiptRead['confidence']) => scanned && c[k] ? <span className={cn('ms-1.5 rounded-full px-1.5 py-px text-[10.5px] font-semibold', c[k] === 'high' ? 'bg-success/10 text-success' : c[k] === 'medium' ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger')}>{c[k] === 'high' ? 'read' : c[k] === 'medium' ? 'check' : 'unsure'}</span> : null
  const pick = 'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition-colors focus-within:ring-2 focus-within:ring-primary/40'
  const tint = (k: keyof ReceiptRead['confidence']) => scanned && c[k] ? 'bg-warning/10' : undefined

  return <div ref={box} className="dup-wrap grid gap-4 sm:grid-cols-2 [&_[data-suggested='1']]:bg-warning/10">
    {/* receipt: take a photo or upload; read at once */}
    <div className="rounded-2xl border border-dashed border-border bg-surface-2/40 p-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-auto text-sm font-medium">{scan.file ? <>Receipt: <span className="text-muted">{scan.file}</span></> : e?.receipt_document_id ? 'A receipt is attached. Add another to replace it.' : 'Receipt (optional)'}</span>
        <label onPointerDown={warmScan} className={cn(pick, 'bg-ink text-ink-fg hover:opacity-90')}><Camera size={17} aria-hidden />Take photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo of the receipt" onChange={ev => attach(ev.target.files?.[0])} /></label>
        <label onPointerDown={warmScan} className={cn(pick, 'border border-border bg-surface hover:bg-surface-2')}><Upload size={16} aria-hidden />Upload image or PDF
          <input ref={fileRef} type="file" name="file" accept="image/*,application/pdf" className="sr-only" aria-label="Receipt file" onChange={ev => { const f = ev.target.files?.[0]; if (f) void read(f) }} /></label>
      </div>
      {scan.err && <p className="mt-2.5 text-[13px] text-danger" role="alert">{scan.err}</p>}
      {(scan.busy || scan.result) && <div className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
        <div className={cn('relative overflow-hidden rounded-lg border border-border bg-surface', scan.busy && 'scan-sweep')}>
          {preview ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={preview} alt="The receipt you scanned" className="max-h-44 w-full object-contain" /> : <div className="grid h-20 place-items-center text-xs text-muted">PDF</div>}</div>
        <div className="min-w-0 space-y-2 text-[13px]">
          {scan.busy && <p className="flex items-center gap-2 text-muted" role="status" data-scan-stage={scan.stage}><Loader2 size={14} className="animate-spin text-primary" aria-hidden />{
            !scan.result ? (scan.stage === 'cloud' ? 'Reading with the OCR service…' : scan.stage === 'ai' ? 'Reading the photo with Google AI…' : 'Reading on this server…')
              : scan.stage === 'ai' ? 'Filled from the free reading. Double-checking with Google AI…' : 'Filled from the free reading. Double-checking with the OCR service…'}</p>}
        {scan.result && <div className="space-y-2" role="status" data-scan-summary data-scan-bytes={scan.result.bytes} {...(scan.final ? { 'data-scan-done': '' } : {})}>
          <p className="flex items-start gap-1.5 font-medium"><ScanText size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden />Filled from the receipt ({readBy(scan.result)}{scan.result.cached ? ', read before' : ''}). Tinted fields are suggestions: check each one against the receipt.</p>
          {scan.result.supplier && <p className="flex items-center gap-1.5 text-success"><CheckCircle2 size={14} aria-hidden />Matched your saved supplier {scan.result.supplier.name}</p>}
          {scan.result.duplicate && <p className="flex items-start gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-danger"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />Already saved: bill {scan.result.duplicate.reference} from this supplier on {scan.result.duplicate.spent_on} (AED {(scan.result.duplicate.amount + scan.result.duplicate.vat_amount).toFixed(2)}).</p>}
          {[...scan.result.read.warnings, ...(scan.result.aiNote ? [scan.result.aiNote] : [])].map(w => <p key={w} className="flex items-start gap-1.5 text-warning"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />{w}</p>)}
          {scan.result.read.total !== undefined && <p className="text-muted">Receipt total: <b className="tabular-nums text-fg">AED {scan.result.read.total.toFixed(2)}</b>{Math.abs(scan.result.read.total - total) > 0.01 && <span className="text-warning"> · the form adds up to AED {total.toFixed(2)}</span>}</p>}
        </div>}
        </div>
      </div>}
      <input type="hidden" name="source" value={scanned ? 'scan' : 'manual'} />
      {scanned && <input type="hidden" name="ocr_suggested" value={JSON.stringify({ ...scan.result!.read, provider: scan.result!.provider, engine: scan.result!.engine })} />}
    </div>

    {/* supplier */}
    <Field label="Supplier" hint={claim ? 'The shop or company on the receipt' : known ? (known.trn ? `Saved supplier · TRN ${known.trn}` : 'Saved supplier') : supplier.trim() ? 'New: added to your suppliers when you save' : 'Pick a saved supplier or type a new name'}>
      <Input name="supplier_name" maxLength={200} list="exp-suppliers" value={supplier} className={tint('supplier')}
        onChange={ev => { setSupplier(ev.target.value); const k = sups.find(s => s.name.toLowerCase() === ev.target.value.trim().toLowerCase()); if (k?.trn && !trn) setTrn(k.trn) }} />
      <datalist id="exp-suppliers">{sups.map(s => <option key={s.id || s.name} value={s.name} />)}</datalist></Field>
    {!claim && known?.id && <input type="hidden" name="supplier_id" value={known.id} />}
    <Field label="Supplier TRN" hint="15 digits, on their tax invoice"><Input name="supplier_trn" inputMode="numeric" maxLength={20} value={trn} onChange={ev => setTrn(ev.target.value)} placeholder="100xxxxxxxxxxxx" className={tint('trn')} /></Field>

    {/* the bill */}
    <Field label="Invoice / receipt no." hint="The supplier's number on the bill"><Input name="reference" maxLength={120} defaultValue={e?.reference ?? ''} /></Field>
    <Field label="Date *"><Input name="spent_on" type="date" required max={today} defaultValue={e?.spent_on ?? today} /></Field>
    {!claim && <label className={cn('dup-anyway hidden items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger sm:col-span-2', scan.result?.duplicate && '!flex')}><input type="checkbox" name="allow_duplicate" className="h-4 w-4 accent-[hsl(var(--danger))]" />This is a different bill with the same number: save anyway</label>}
    <Field label="Category *"><Select name="category" defaultValue={e?.category ?? 'material'}>{Object.entries(EXPENSE_CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
    <Field label="Quantity" hint="Optional (e.g. 40 pcs)"><Input name="quantity" type="number" step="0.001" min="0" inputMode="decimal" defaultValue={e?.quantity ?? ''} /></Field>
    <Field label="Description *" className="sm:col-span-2"><Input name="description" required maxLength={500} defaultValue={e?.description ?? ''} placeholder="e.g. MS hollow section 100×50×3: 40 pcs" /></Field>

    {/* amounts */}
    <Field label="Amount excl. VAT (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" value={amount} onChange={ev => setAmount(ev.target.value)} className={tint('subtotal')} /></Field>
    <Field label="VAT rate"><Select aria-label="VAT rate" value={rate} onChange={ev => { if (ev.target.value === 'custom') setVat(vatNum.toFixed(2)); setRate(ev.target.value) }}>{RATES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    <Field label="VAT (AED)" hint={rate === 'custom' ? 'Input VAT on the receipt' : 'Worked out from the rate; type to change'}>
      <Input name="vat_amount" type="number" step="0.01" min="0" inputMode="decimal" value={rate === 'custom' ? vat : vatNum.toFixed(2)} onChange={ev => { setRate('custom'); setVat(ev.target.value) }}
        className={cn(rate !== 'custom' && 'text-muted', rate === 'custom' && tint('vat'))} /></Field>
    <input type="hidden" name="vat_rate" value={rate === 'custom' ? (num(amount) > 0 ? String(r2((num(vat) / num(amount)) * 100)) : '') : rate} />
    <div className="flex flex-col justify-end"><div className="rounded-xl bg-surface-2 px-3.5 py-2.5"><div className="text-[12px] text-muted">Total incl. VAT</div><div className="text-[19px] font-semibold tabular-nums tracking-[-0.01em]" data-total>AED {total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div>

    {/* payment */}
    {claim ? <Field label="How did you pay?"><Select name="paid_with" defaultValue={e?.paid_with ?? 'cash'}>{[['cash', 'Cash'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['other', 'Other']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    : <><fieldset className="sm:col-span-2"><legend className="mb-1.5 text-[13px] font-medium">Payment</legend>
      <div className="inline-flex flex-wrap rounded-xl bg-surface-2 p-1">{(['paid', 'unpaid'] as const).map(k => <label key={k} className={cn('cursor-pointer rounded-lg px-4 py-2 text-[14px] font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40', status === k ? 'bg-surface shadow-card' : 'text-muted')}>
        <input type="radio" name="payment_status" value={k} checked={status === k} onChange={() => setStatus(k)} className="sr-only" />{k === 'paid' ? 'Paid' : 'Unpaid (owed to supplier)'}</label>)}</div></fieldset>
    {status === 'paid' ? <>
      <Field label="Payment method"><Select name="payment_method" defaultValue={e?.payment_method && e.payment_method !== 'credit' ? e.payment_method : 'cash'}>{Object.entries(PAYMENT_METHODS).filter(([k]) => k !== 'credit').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <AccountSelect name="paid_from_bank_id" label="Paid from" value={e ? e.paid_from_bank_id ?? null : undefined} />
      <Field label="Payment reference" hint="Cheque no., transfer ref., card slip"><Input name="payment_ref" maxLength={120} defaultValue={e?.payment_ref ?? ''} /></Field>
    </> : <p className="self-center text-[13px] text-muted sm:col-span-2">Saved as a bill owed to {supplier.trim() || 'the supplier'}. In Tally it is booked as a purchase against the supplier&apos;s ledger.</p>}</>}

    {/* links */}
    {!claim && !fixedProject && projects && <Field label="Project"><Select name="project_id" defaultValue={e?.project_id ?? ''}><option value="">— General / no project —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
    {!claim && assets && assets.length > 0 && <Field label="Vehicle / asset" hint="Fuel, Salik, parts or repairs for one item"><Select name="asset_id" defaultValue={e?.asset_id ?? ''}><option value="">None</option>{assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
    {!claim && <Field label="Employee" hint="Who paid / used it"><Select name="employee_id" defaultValue={e?.employee_id ?? ''}><option value="">—</option>{employees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}

    {/* line items */}
    <div className="sm:col-span-2">
      {!showLines ? <button type="button" onClick={() => { setShowLines(true); if (!lines.length) setLines([{ description: '', quantity: '', unit_price: '', amount: '' }]) }} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"><Plus size={14} aria-hidden />Add line items</button>
        : <div className="rounded-xl border border-border">
          <div className="flex items-center gap-1 border-b border-border px-3 py-2 text-[13px] font-medium">Line items{sure('lines')}<span className="ms-auto tabular-nums text-muted">Sum AED {r2(lines.reduce((s, l) => s + num(l.amount), 0)).toFixed(2)}</span></div>
          <div className="divide-y divide-border">{lines.map((l, i) => <div key={i} className="grid grid-cols-[minmax(0,1fr)_64px_84px_92px_32px] items-center gap-1.5 px-2 py-1.5 max-sm:grid-cols-[minmax(0,1fr)_92px_32px]">
            <input aria-label={`Item ${i + 1} description`} value={l.description} onChange={ev => setLines(xs => xs.map((x, j) => j === i ? { ...x, description: ev.target.value } : x))} className="h-9 min-w-0 rounded-md bg-surface-2 px-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/30" placeholder="Item" />
            <input aria-label={`Item ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={ev => setLines(xs => xs.map((x, j) => j === i ? { ...x, quantity: ev.target.value } : x))} className="h-9 rounded-md bg-surface-2 px-2 text-end text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-primary/30 max-sm:hidden" placeholder="Qty" />
            <input aria-label={`Item ${i + 1} unit price`} inputMode="decimal" value={l.unit_price} onChange={ev => setLines(xs => xs.map((x, j) => j === i ? { ...x, unit_price: ev.target.value } : x))} className="h-9 rounded-md bg-surface-2 px-2 text-end text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-primary/30 max-sm:hidden" placeholder="Rate" />
            <input aria-label={`Item ${i + 1} amount`} inputMode="decimal" value={l.amount} onChange={ev => setLines(xs => xs.map((x, j) => j === i ? { ...x, amount: ev.target.value } : x))} className="h-9 rounded-md bg-surface-2 px-2 text-end text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-primary/30" placeholder="Amount" />
            <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => setLines(xs => xs.filter((_, j) => j !== i))} className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger"><Trash2 size={14} /></button></div>)}</div>
          <button type="button" onClick={() => setLines(xs => [...xs, { description: '', quantity: '', unit_price: '', amount: '' }])} className="m-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-primary hover:bg-primary-soft"><Plus size={14} aria-hidden />Add line</button>
        </div>}
      {showLines && <input type="hidden" name="items" value={JSON.stringify(lines.filter(l => l.description.trim() && l.amount.trim() !== '').map(l => ({ description: l.description.trim(), quantity: l.quantity ? num(l.quantity) : null, unit_price: l.unit_price ? num(l.unit_price) : null, amount: r2(num(l.amount)) })))} />}
    </div>

    <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} maxLength={2000} defaultValue={e?.notes ?? ''} /></Field>
    {scanned && <label className="flex items-start gap-2.5 rounded-xl bg-primary-soft px-3.5 py-3 text-[14px] text-primary sm:col-span-2">
      <input type="checkbox" name="verified" required className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
      <span><b className="font-semibold">I checked these details against the receipt.</b> Scanned values are never saved until someone confirms them.</span></label>}
  </div>
}
