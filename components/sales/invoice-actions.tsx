'use client'
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { AccountSelect } from '@/components/banking/account-select'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Ban, Banknote, CheckCircle2, CircleDollarSign, Download, Eye, FileText, Loader2, MessageCircle, MoreHorizontal, PenLine, Printer, RotateCcw } from '@/components/icons'
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { Modal, useDialog } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { WhatsAppSend } from '@/components/whatsapp/send'
import { markInvoiceUnpaid, markInvoiceViewed, recordPayment, setSalesStatus } from '@/app/actions/sales'
import { balanceOf, paymentActions } from '@/lib/sales/status'
import { fmtMoney } from '@/lib/sales/money'
import { ACCEPT_ATTR } from '@/lib/file-types'
import { cn } from '@/lib/utils'

export interface InvoiceMoney { id: string; number: string; status: string; total: number; paid: number; credited: number; due_date: string | null; viewed?: boolean }
export interface ChequeOpt { id: string; label: string }
type Mode = 'record' | 'full' | 'partial' | 'unpaid' | 'cancel'
const METHOD: [string, string][] = [['bank_transfer', 'Bank transfer'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['pdc', 'PDC cheque'], ['card', 'Card'], ['other', 'Other']]
const TITLE: Record<Mode, string> = { record: 'Record payment', full: 'Mark as paid', partial: 'Mark as partially paid', unpaid: 'Mark as unpaid', cancel: 'Cancel invoice' }

/** The payment / status dialogs of one invoice (Record payment, Mark as paid / partially paid / unpaid, Cancel). */
function InvoiceDialog({ inv, mode, onClose, today, cheques, canUpload, canDelete }: { inv: InvoiceMoney; mode: Mode; onClose: () => void; today: string; cheques?: ChequeOpt[]; canUpload?: boolean; canDelete?: boolean }) {
  const bal = balanceOf(inv)
  return <Modal title={`${TITLE[mode]}: ${inv.number}`} onClose={onClose} wide={mode === 'record' || mode === 'partial' || mode === 'full'}>
    {mode === 'unpaid' ? <UnpaidForm inv={inv} canDelete={canDelete} />
      : mode === 'cancel' ? <CancelForm inv={inv} />
      : <PaymentForm inv={inv} mode={mode} bal={bal} today={today} cheques={cheques} canUpload={canUpload} />}
  </Modal>
}

function Summary({ inv, bal }: { inv: InvoiceMoney; bal: number }) {
  return <dl className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm" data-pay-summary>
    {[['Invoice total', inv.total], ['Paid', inv.paid], ['Balance', bal]].map(([k, v]) => <div key={k as string} className="bg-surface-2/60 px-3 py-2">
      <dt className="text-[11px] text-muted">{k}</dt><dd className={cn('mt-0.5 font-semibold tabular-nums', k === 'Balance' && bal > 0 && 'text-warning')}>{fmtMoney(v as number)}</dd></div>)}
  </dl>
}

function PaymentForm({ inv, mode, bal, today, cheques, canUpload }: { inv: InvoiceMoney; mode: 'record' | 'full' | 'partial'; bal: number; today: string; cheques?: ChequeOpt[]; canUpload?: boolean }) {
  const max = mode === 'partial' ? Math.max(0.01, bal - 0.01) : bal
  return <ActionForm action={recordPayment.bind(null, inv.id)} submit={mode === 'full' ? `Record AED ${fmtMoney(bal)} and mark as paid` : mode === 'partial' ? 'Save part payment' : 'Save payment'} idempotent>
    <input type="hidden" name="mode" value={mode} />
    <Summary inv={inv} bal={bal} />
    {mode === 'full' && <p className="mb-1 rounded-md bg-success/[.07] px-3 py-2 text-sm text-success">A payment of <b className="tabular-nums">AED {fmtMoney(bal)}</b> (the full balance) is recorded, and the invoice becomes <b>Paid</b>.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      {mode === 'full' ? <input type="hidden" name="amount" value={bal.toFixed(2)} />
        : <Field label="Amount (AED) *" hint={mode === 'partial' ? `Less than the balance of AED ${fmtMoney(bal)}` : `Outstanding: AED ${fmtMoney(bal)}`}>
          <Input name="amount" type="number" step="0.01" min="0.01" max={max.toFixed(2)} defaultValue={mode === 'record' ? bal.toFixed(2) : ''} required inputMode="decimal" autoFocus={mode === 'partial'} /></Field>}
      <Field label="Payment date *"><Input name="paid_on" type="date" defaultValue={today} max={today} required /></Field>
      <Field label="Payment method *"><Select name="method" defaultValue="bank_transfer">{METHOD.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="Reference" hint="Transfer ref., receipt or cheque no."><Input name="reference" maxLength={120} /></Field>
      <Field label="Bank"><Input name="bank_name" maxLength={120} placeholder="e.g. Emirates NBD" /></Field>
      <AccountSelect name="deposit_bank_id" label="Deposited to" />
      {cheques && <Field label="Cleared cheque" hint={cheques.length ? 'Only cheques confirmed as Cleared appear here' : 'No cleared cheques to apply. Mark the cheque Cleared under Cheques first.'}>
        <Select name="cheque_id" defaultValue="" disabled={!cheques.length}><option value="">— None —</option>{cheques.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}</Select></Field>}
      {canUpload && <Field label="Receipt / proof (optional)" className="sm:col-span-2"><input type="file" name="file" accept={ACCEPT_ATTR} className="text-sm" /></Field>}
      <Field label="Notes" className="sm:col-span-2"><Input name="notes" maxLength={1000} /></Field>
    </div>
  </ActionForm>
}

function UnpaidForm({ inv, canDelete }: { inv: InvoiceMoney; canDelete?: boolean }) {
  return <ActionForm action={markInvoiceUnpaid.bind(null, inv.id)} submit="Mark as unpaid" variant="danger">
    <p className="text-sm">This takes the <b className="tabular-nums">AED {fmtMoney(inv.paid)}</b> recorded against {inv.number} off the invoice, so it shows as unpaid again.</p>
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-xs font-medium">What happens to the money</legend>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
        <input type="radio" name="how" value="credit" defaultChecked className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
        <span className="text-sm"><b>Keep it as customer credit</b> (recommended)<span className="block text-xs text-muted">The payments stay recorded as money received on account. They still show in the customer ledger and statement, and can be applied again. Project advances go back to their project.</span></span></label>
      {canDelete && <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-[:checked]:border-danger has-[:checked]:bg-danger/[.04]">
        <input type="radio" name="how" value="delete" className="mt-0.5 h-4 w-4 accent-[hsl(var(--danger))]" />
        <span className="text-sm"><b>Delete the payment records</b><span className="block text-xs text-muted">Only when they were entered by mistake. The deletion is kept in the audit log.</span></span></label>}
    </fieldset>
    <Field label="Reason *" hint="Saved in the invoice history"><Textarea name="reason" required minLength={3} maxLength={300} rows={2} placeholder="e.g. Cheque bounced / recorded on the wrong invoice" /></Field>
  </ActionForm>
}

function CancelForm({ inv }: { inv: InvoiceMoney }) {
  const router = useRouter(), [pending, start] = useTransition()
  const { close } = useDialog()
  return <div className="flex flex-col gap-4">
    <p className="text-sm">Cancel <b>{inv.number}</b>? It stays on record (with its number) but can no longer be edited, paid or sent. To correct an issued invoice that was already accepted, issue a credit note instead.</p>
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={close}>Keep invoice</Button>
      <Button variant="danger" disabled={pending} onClick={() => start(async () => { const r = await setSalesStatus(inv.id, 'cancelled'); if (r?.error) toast(r.error, 'error'); else { toast('Invoice cancelled.'); close(); router.refresh() } })}>{pending && <Loader2 size={14} className="animate-spin" />}Cancel invoice</Button></div>
  </div>
}

function useMarkViewed(inv: InvoiceMoney) {
  const router = useRouter(), [pending, start] = useTransition()
  return { pending, run: () => start(async () => { const r = await markInvoiceViewed(inv.id); if (r?.error) toast(r.error, 'error'); else { toast(r?.message ?? 'Marked as viewed.'); router.refresh() } }) }
}

/** Invoice page: the payment actions as visible buttons (two columns on phones), never hidden in a menu. */
export function InvoicePaymentActions({ inv, today, cheques, canEdit, canDelete, canUpload }: { inv: InvoiceMoney; today: string; cheques?: ChequeOpt[]; canEdit: boolean; canDelete?: boolean; canUpload?: boolean }) {
  const [mode, setMode] = useState<Mode | null>(null)
  const a = paymentActions(inv), viewed = useMarkViewed(inv)
  if (!canEdit) return null
  const btn = 'max-sm:h-11 max-sm:w-full max-sm:justify-center'
  return <>
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end" data-invoice-actions>
      {a.record && <Button size="sm" className={btn} onClick={() => setMode('record')}><Banknote size={14} />Record payment</Button>}
      {a.markPaid && <Button size="sm" variant="secondary" className={cn(btn, 'text-success')} onClick={() => setMode('full')}><CheckCircle2 size={14} />Mark as paid</Button>}
      {a.markPartial && <Button size="sm" variant="secondary" className={btn} onClick={() => setMode('partial')}><CircleDollarSign size={14} />Mark partially paid</Button>}
      {a.markUnpaid && <Button size="sm" variant="secondary" className={btn} onClick={() => setMode('unpaid')}><RotateCcw size={14} />Mark as unpaid</Button>}
      {inv.status !== 'draft' && inv.status !== 'cancelled' && !inv.viewed && <Button size="sm" variant="ghost" className={btn} disabled={viewed.pending} onClick={viewed.run}><Eye size={14} />Mark as viewed</Button>}
      {a.cancel && <Button size="sm" variant="ghost" className={cn(btn, 'text-danger')} onClick={() => setMode('cancel')}><Ban size={14} />Cancel invoice</Button>}
    </div>
    {mode && <InvoiceDialog inv={inv} mode={mode} onClose={() => setMode(null)} today={today} cheques={cheques} canUpload={canUpload} canDelete={canDelete} />}
  </>
}

/**
 * Quick actions for an invoice in a list / card: Open · Record payment · Mark paid · Edit · Download PDF · WhatsApp ·
 * More (partially paid, unpaid, print, cancel). `inline` adds the Record payment button next to the menu (desktop rows).
 */
export function InvoiceRowActions({ inv, today, canEdit, canDelete, inline }: { inv: InvoiceMoney; today: string; canEdit: boolean; canDelete?: boolean; inline?: boolean }) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [open, setOpen] = useState(false)
  const wa = useRef<() => void>(() => {})
  const ref = useRef<HTMLDivElement>(null)
  const a = paymentActions(inv), issued = inv.status !== 'draft' && inv.status !== 'cancelled'
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const pick = (m: Mode) => { setOpen(false); setMode(m) }
  const item = 'flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-start text-sm hover:bg-surface-2 sm:min-h-9'
  const Item = ({ icon: Icon, children, onClick, href, danger, external }: { icon: typeof FileText; children: ReactNode; onClick?: () => void; href?: string; danger?: boolean; external?: boolean }) =>
    href ? <Link role="menuitem" href={href} prefetch={false} target={external ? '_blank' : undefined} className={cn(item, danger && 'text-danger')} onClick={() => setOpen(false)}><Icon size={15} aria-hidden />{children}</Link>
      : <button role="menuitem" type="button" className={cn(item, danger && 'text-danger')} onClick={onClick}><Icon size={15} aria-hidden />{children}</button>
  return <div ref={ref} className="relative inline-flex items-center gap-1" data-row-stop data-row-actions>
    {inline && canEdit && a.record && <Button size="sm" variant="secondary" onClick={() => setMode('record')} aria-label={`Record payment for ${inv.number}`} title="Record payment"><Banknote size={14} /><span className="hidden 2xl:inline">Record payment</span></Button>}
    <button type="button" aria-label={`Actions for ${inv.number}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
      className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg active:scale-95 sm:h-8 sm:w-8"><MoreHorizontal size={18} /></button>
    {open && <div role="menu" aria-label={`Actions for ${inv.number}`} className="toast-in absolute end-0 top-full z-30 mt-1 max-h-[70vh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-surface p-1 text-fg shadow-pop">
      <Item icon={FileText} href={`/invoices/${inv.id}`}>Open</Item>
      {canEdit && a.record && <Item icon={Banknote} onClick={() => pick('record')}>Record payment</Item>}
      {canEdit && a.markPaid && <Item icon={CheckCircle2} onClick={() => pick('full')}>Mark as paid</Item>}
      {canEdit && ['draft', 'sent', 'overdue'].includes(inv.status) && inv.paid === 0 && <Item icon={PenLine} href={`/invoices/${inv.id}`}>Edit</Item>}
      <Item icon={Download} href={`/api/sales/${inv.id}/pdf`} external>Download PDF</Item>
      {canEdit && <Item icon={MessageCircle} onClick={() => { setOpen(false); wa.current() }}>Send via WhatsApp</Item>}
      <div className="my-1 border-t border-border" role="separator" />
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">More actions</div>
      <Item icon={Printer} onClick={() => { setOpen(false); window.open(`/print/sales/${inv.id}?auto=1`, '_blank') }}>Print</Item>
      {canEdit && a.markPartial && <Item icon={CircleDollarSign} onClick={() => pick('partial')}>Mark as partially paid</Item>}
      {canEdit && a.markUnpaid && <Item icon={RotateCcw} onClick={() => pick('unpaid')}>Mark as unpaid</Item>}
      {canEdit && issued && !inv.viewed && <Item icon={Eye} onClick={async () => { setOpen(false); const r = await markInvoiceViewed(inv.id); toast(r?.error ?? r?.message ?? 'Marked as viewed.', r?.error ? 'error' : undefined) }}>Mark as viewed</Item>}
      {canEdit && a.cancel && <Item icon={Ban} danger onClick={() => pick('cancel')}>Cancel invoice</Item>}
    </div>}
    {canEdit && <WhatsAppSend kind="invoice" recordId={inv.id} trigger={o => { wa.current = o; return null }} />}
    {mode && <InvoiceDialog inv={inv} mode={mode} onClose={() => setMode(null)} today={today} canDelete={canDelete} />}
  </div>
}
