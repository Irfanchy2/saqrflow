'use client'
import { startTransition, useActionState, useMemo, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Alert, Button, Field, Input } from '@/components/ui/primitives'
import { SalesPaper, type Branding, type PaperDoc, type PaperItem } from '@/components/sales/paper'
import { FitPaper } from '@/components/sales/preview'
import { FIELD_LABEL, FIELDS_FOR, TEMPLATE_KINDS, TEMPLATE_LABEL, defaultTemplate, resolveTemplate, type DocTemplate, type TemplateKind } from '@/lib/sales/template'
import { saveDocTemplate } from '@/app/actions/templates'
import type { ActionState } from '@/lib/utils'

const SAMPLE_ITEMS: PaperItem[] = [
  { description: 'Fabrication and installation of MS staircase with handrail, primer and two coats of paint', materials: 'MS hollow section 50×50×3 mm', quantity: 1, unit: 'LS', unit_price: 18500 },
  { description: 'Supply and fixing of GI sliding gate with motor', quantity: 2, unit: 'Nos', unit_price: 6250 },
]
const sample = (kind: TemplateKind, today: string): PaperDoc => ({
  doc_type: kind, number: kind === 'quotation' ? 'AS-002600/2026' : kind === 'invoice' ? 'INV-610' : 'DL-1300', issue_date: today, due_date: kind === 'invoice' ? today : null, valid_until: kind === 'quotation' ? today : null,
  attention: 'Mr. Ahmed', customer_name: 'Sample Client LLC', customer_address: 'Al Quoz Industrial Area 3, Dubai', customer_trn: '100123456700003', customer_phone: '+971 50 123 4567', customer_email: 'accounts@client.ae',
  site: 'Villa 9, Al Barsha', subject: 'Steel works for Villa 9', intro: 'Dear Sir, with reference to your enquiry we are pleased to quote as follows.', closing: 'Thanking you,\nYours faithfully',
  lpo_ref: 'LPO-4471', del_no: 'DL-1300', reference: 'WhatsApp 02-Oct', project_name: 'Villa 9 steel works', vat_rate: 5, apply_vat: true, show_total: true,
  terms: ['Prices are valid for 30 days.', 'Civil works by others.'], payment_terms: ['50% advance', '50% on completion'], receiver_name: null, vehicle_no: 'Dubai K 12345',
})

/** Settings → Template builder: per document type, choose title, fields, column names, blocks and a footer note, with a live A4 preview. */
export function TemplateBuilder({ branding, saved, today }: { branding: Branding; saved: Partial<Record<TemplateKind, unknown>>; today: string }) {
  const [kind, setKind] = useState<TemplateKind>('quotation')
  const [drafts, setDrafts] = useState<Record<TemplateKind, DocTemplate>>(() => Object.fromEntries(TEMPLATE_KINDS.map(k => [k, resolveTemplate(k, saved[k])])) as Record<TemplateKind, DocTemplate>)
  const tp = drafts[kind]
  const set = (patch: Partial<DocTemplate>) => setDrafts(d => ({ ...d, [kind]: { ...d[kind], ...patch } }))
  const [state, run, pending] = useActionState(async (_: ActionState, k: TemplateKind) => saveDocTemplate(k, JSON.stringify(drafts[k])), null)
  const doc = useMemo(() => sample(kind, today), [kind, today])
  const preview = useMemo(() => ({ ...branding, templates: { [kind]: tp } }), [branding, kind, tp])
  const inv = kind === 'invoice', def = defaultTemplate(kind)
  const check = (label: string, on: boolean, onChange: (v: boolean) => void, hint?: string) =>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} className="mt-0.5" /><span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span></label>

  return <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" data-template-builder>
    <div className="min-w-0 space-y-4">
      <div role="tablist" aria-label="Document type" className="flex flex-wrap gap-1 border-b border-border">{TEMPLATE_KINDS.map(k =>
        <button key={k} role="tab" type="button" aria-selected={k === kind} onClick={() => setKind(k)} className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm ${k === kind ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}`}>{TEMPLATE_LABEL[k]}</button>)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title on the document" hint={`empty = “${inv ? 'Tax Invoice' : kind === 'quotation' ? 'QUOTATION' : 'Delivery Note'}”`}><Input value={tp.title} maxLength={40} onChange={e => set({ title: e.target.value })} aria-label="Document title" /></Field>
        <Field label="Heading above the items" hint="empty = no heading"><Input value={tp.scopeHeading} maxLength={80} onChange={e => set({ scopeHeading: e.target.value })} aria-label="Items heading" /></Field>
      </div>
      <fieldset><legend className="mb-1.5 text-sm font-medium">Show these details</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">{FIELDS_FOR[kind].map(k => <div key={k}>{check(FIELD_LABEL[k], tp.fields[k], v => set({ fields: { ...tp.fields, [k]: v } }))}</div>)}</div>
        <p className="mt-1 text-xs text-muted">Optional details only print when the document has a value. Customer name, address, number and date always print.</p></fieldset>
      <fieldset><legend className="mb-1.5 text-sm font-medium">Column names</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Description"><Input value={tp.labels.description} maxLength={30} onChange={e => set({ labels: { ...tp.labels, description: e.target.value } })} aria-label="Description column" /></Field>
          <Field label="Quantity"><Input value={tp.labels.qty} maxLength={20} onChange={e => set({ labels: { ...tp.labels, qty: e.target.value } })} aria-label="Quantity column" /></Field>
          <Field label={inv ? 'Rate' : 'Unit price'}><Input value={tp.labels.rate} maxLength={30} onChange={e => set({ labels: { ...tp.labels, rate: e.target.value } })} aria-label="Rate column" /></Field>
          <Field label={inv ? 'Amount (before VAT)' : 'Line total'}><Input value={tp.labels.total} maxLength={30} onChange={e => set({ labels: { ...tp.labels, total: e.target.value } })} aria-label="Total column" /></Field>
        </div>
        {inv && <p className="mt-1 text-xs text-muted">The VAT and “Amount With Vat” columns, your TRN and the totals are required on a UAE tax invoice and always print.</p>}</fieldset>
      <fieldset className="space-y-1.5"><legend className="mb-1.5 text-sm font-medium">Blocks</legend>
        {check('Seal, signature and signatory', tp.showSignature, v => set({ showSignature: v }), 'uses the images and name from Branding')}
        {check('Bank details', tp.showBank, v => set({ showBank: v }), branding.bankDetails ? undefined : 'add bank details under Branding first')}
        {inv && check('Amount in words', tp.showWords, v => set({ showWords: v }))}
        {inv && check('“This is a computer-generated report.”', tp.showComputerLine, v => set({ showComputerLine: v }))}</fieldset>
      <Field label="Footer note" hint="optional, printed after everything else (e.g. Thank you for your business)"><Input value={tp.footerNote} maxLength={300} onChange={e => set({ footerNote: e.target.value })} aria-label="Footer note" /></Field>
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {state?.ok && state.message && <Alert tone="green">{state.message}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setDrafts(d => ({ ...d, [kind]: def }))} disabled={JSON.stringify(tp) === JSON.stringify(def)}><RotateCcw size={14} />Standard layout</Button>
        <Button type="button" disabled={pending} onClick={() => startTransition(() => run(kind))}>{pending && <Loader2 size={14} className="animate-spin" />}Save {TEMPLATE_LABEL[kind].toLowerCase()} template</Button></div>
      <p className="text-xs text-muted">Layout only: saving never changes what a document says. Company letterhead, seal and signature come from Branding.</p>
    </div>
    <div className="min-w-0"><div className="rounded-xl bg-surface-2 p-3 sm:p-4" aria-label="Live preview"><FitPaper><SalesPaper doc={doc} items={SAMPLE_ITEMS} branding={preview} /></FitPaper></div>
      <p className="mt-2 text-xs text-muted">Preview with sample data and your branding. The print view and PDF follow the same template.</p></div>
  </div>
}
