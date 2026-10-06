'use client'
import { useRef, useState } from 'react'
import { Loader2, ScanText } from 'lucide-react'
import { Field, Input, Select, Textarea, Button } from '@/components/ui/primitives'
import { EXPENSE_CATS, PAYMENT_METHODS } from '@/lib/projects'
import { ACCEPT_ATTR } from '@/lib/file-types'

type Opt = { id: string; name: string }
/**
 * Expense form fields. "Read receipt" runs OCR on the chosen file and FILLS the fields as suggestions (highlighted);
 * nothing is saved until the user checks them and presses Save.
 */
export function ExpenseFields({ e, today, projects, employees, suppliers, fixedProject }: { e?: Record<string, any>; today: string; projects?: Opt[]; employees: Opt[]; suppliers: string[]; fixedProject?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [scan, setScan] = useState<{ busy: boolean; msg?: string; err?: string }>({ busy: false })
  const read = async () => {
    const form = box.current?.closest('form'); const file = (form?.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0]
    if (!form || !file) { setScan({ busy: false, err: 'Choose the receipt file first.' }); return }
    setScan({ busy: true })
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch('/api/expenses/scan', { method: 'POST', body: fd }); const j = await r.json().catch(() => ({}))
      if (!r.ok) { setScan({ busy: false, err: j.error ?? 'The receipt could not be read. Enter the details manually.' }); return }
      const g = j.fields ?? {}, set = (n: string, v: unknown) => { const el = form.elements.namedItem(n) as HTMLInputElement | null; if (el && v !== undefined && v !== null && v !== '') { el.value = String(v); el.dataset.suggested = '1' } }
      const vat = typeof g.vat === 'number' ? g.vat : undefined
      set('supplier_name', g.supplier); set('spent_on', g.date); set('reference', g.reference); set('vat_amount', vat)
      if (typeof g.amount === 'number') set('amount', (Math.round((g.amount - (vat ?? 0)) * 100) / 100).toFixed(2))
      const n = ['supplier', 'date', 'amount', 'vat', 'reference'].filter(k => g[k] !== undefined).length
      setScan({ busy: false, msg: n ? `Filled ${n} field${n === 1 ? '' : 's'} from the receipt — please check them (highlighted) before saving.` : 'No details could be recognised. Enter them manually.' })
    } catch { setScan({ busy: false, err: 'Network problem while reading the receipt. Try again or enter the details manually.' }) }
  }
  return <div ref={box} className="grid gap-4 sm:grid-cols-2 [&_[data-suggested='1']]:bg-warning/10">
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3 sm:col-span-2">
      <label className="text-sm font-medium" htmlFor="exp-file">Receipt (optional)</label>
      <div className="flex flex-wrap items-center gap-2"><input id="exp-file" type="file" name="file" accept={ACCEPT_ATTR} className="min-w-0 flex-1 text-sm" />
        <Button type="button" size="sm" variant="secondary" onClick={read} disabled={scan.busy}>{scan.busy ? <Loader2 size={14} className="animate-spin" /> : <ScanText size={14} />}Read receipt</Button></div>
      {scan.msg && <p className="text-xs text-muted" role="status">{scan.msg}</p>}{scan.err && <p className="text-xs text-danger" role="alert">{scan.err}</p>}
    </div>
    <Field label="Date *"><Input name="spent_on" type="date" required max={today} defaultValue={e?.spent_on ?? today} /></Field>
    <Field label="Category *"><Select name="category" defaultValue={e?.category ?? 'material'}>{Object.entries(EXPENSE_CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
    <Field label="Description *" className="sm:col-span-2"><Input name="description" required maxLength={500} defaultValue={e?.description ?? ''} placeholder="e.g. MS hollow section 100×50×3 — 40 pcs" /></Field>
    <Field label="Supplier"><Input name="supplier_name" maxLength={200} list="exp-suppliers" defaultValue={e?.supplier_name ?? ''} /><datalist id="exp-suppliers">{suppliers.map(s => <option key={s} value={s} />)}</datalist></Field>
    <Field label="Reference" hint="Supplier invoice / receipt no."><Input name="reference" maxLength={120} defaultValue={e?.reference ?? ''} /></Field>
    <Field label="Amount excl. VAT (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" defaultValue={e?.amount ?? ''} /></Field>
    <Field label="VAT (AED)" hint="Input VAT on the receipt (0 if none)"><Input name="vat_amount" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={e?.vat_amount ?? 0} /></Field>
    <Field label="Payment method"><Select name="payment_method" defaultValue={e?.payment_method ?? 'cash'}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
    {!fixedProject && projects && <Field label="Project"><Select name="project_id" defaultValue={e?.project_id ?? ''}><option value="">— General / no project —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
    <Field label="Employee" hint="Who paid / used it"><Select name="employee_id" defaultValue={e?.employee_id ?? ''}><option value="">—</option>{employees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
    <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} maxLength={2000} defaultValue={e?.notes ?? ''} /></Field>
  </div>
}
