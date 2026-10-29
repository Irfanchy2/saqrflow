'use client'
import { startTransition, useActionState, useMemo, useState } from 'react'
import { paySalary } from '@/app/actions/salary'
import { Alert, Button, Field, Input, LinkButton, Money, Select, Textarea } from '@/components/ui/primitives'
import { Modal, useDialog } from '@/components/ui/dialog'
import { CheckCircle2, Download, Loader2, Printer, Wallet } from '@/components/icons'
import { cents, fromCents, METHODS, periodLabel, suggestedPay } from '@/lib/salary-math'
import { cn } from '@/lib/utils'
import { ShareSheet } from '@/components/whatsapp/share-sheet'

export type PayTarget = {
  id: string; name: string; no: string; monthly: number | null; outstanding: number; previous: number; currentDue: number; current: number | null
  open: { id: string; kind: string; period: string | null; entry_date: string; remaining: number; reason: string | null }[]
}

/** "Pay" button + the payment sheet, for one employee (salary account page, employee page). */
export function QuickPay({ emp, today, label = 'Pay salary', variant = 'primary', size = 'md' }: { emp: PayTarget; today: string; label?: string; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button variant={variant} size={size} onClick={() => setOpen(true)} data-quick-pay={emp.id}><Wallet size={15} aria-hidden />{label}</Button>
    {open && <PayModal emp={emp} today={today} onClose={() => setOpen(false)} />}
  </>
}

/** The payment sheet. Kept open after saving to offer the receipt; "Record another" starts a fresh form. */
export function PayModal({ emp, today, onClose }: { emp: PayTarget; today: string; onClose: () => void }) {
  const [round, setRound] = useState(0)
  return <Modal title={`Pay ${emp.name}`} onClose={onClose}><PayForm key={round} emp={emp} today={today} again={() => setRound(r => r + 1)} /></Modal>
}

/** Oldest unpaid first (or the chosen period first): what this amount would settle. Same rule as the database. */
function preview(open: PayTarget['open'], amount: number, target: string) {
  let left = cents(amount); const out: { label: string; amount: number }[] = []
  const take = (o: PayTarget['open'][number]) => { const t = Math.min(left, cents(o.remaining)); if (t > 0) { out.push({ label: periodLabel(o), amount: fromCents(t) }); left -= t } }
  const chosen = open.find(o => o.id === target); if (chosen) take(chosen)
  for (const o of open) { if (left <= 0) break; if (o.id !== target) take(o) }
  return { lines: out, credit: fromCents(left) }
}

function PayForm({ emp, today, again }: { emp: PayTarget; today: string; again: () => void }) {
  const [state, run, pending] = useActionState(paySalary, null)
  const [key] = useState(() => crypto.randomUUID())
  const [amount, setAmount] = useState(() => { const s = suggestedPay(emp.outstanding, emp.monthly); return s > 0 ? s.toFixed(2) : '' })
  const [target, setTarget] = useState('')
  const { close } = useDialog()
  const n = Number(amount) || 0
  const plan = useMemo(() => preview(emp.open, n, target), [emp.open, n, target])
  if (state?.ok) {
    const id = state.data?.paymentId as string | undefined, left = Number(state.data?.outstanding ?? 0)   // from the database, after this payment
    return <div className="flex flex-col items-center gap-4 py-2 text-center" data-pay-done>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-success/10 text-success"><CheckCircle2 size={26} aria-hidden /></span>
      <div><p className="text-[16px] font-semibold">{state.message}</p>
        <p className="mt-1 text-[13.5px] text-muted">{left > 0 ? <>Still owed to {emp.name.split(' ')[0]}: <Money value={left} /></> : left < 0 ? <>Paid <Money value={-left} /> more than was owed (kept as credit).</> : 'Nothing is owed now.'}</p></div>
      {id && <div className="flex flex-wrap justify-center gap-2">
        <LinkButton href={`/api/payslips/${id}?view=1`} target="_blank" variant="secondary"><Printer size={15} aria-hidden />Print receipt</LinkButton>
        <LinkButton href={`/api/payslips/${id}`} variant="secondary"><Download size={15} aria-hidden />Download receipt</LinkButton>
        <ShareSheet kind="salary_receipt" recordId={id} size="md" /></div>}
      <div className="flex w-full gap-2 border-t border-border/80 pt-4 sm:justify-end"><Button variant="ghost" onClick={again}>Record another</Button><Button className="flex-1 sm:flex-none" onClick={close}>Done</Button></div>
    </div>
  }
  const submit = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); if (pending) return; const fd = new FormData(e.currentTarget); startTransition(() => run(fd)) }
  const quick: [string, number][] = [['Everything owed', emp.outstanding], ['Earlier months', emp.previous], ["This month's salary", emp.currentDue]]
  return <form onSubmit={submit} className="flex flex-col gap-4" data-pay-form>
    <input type="hidden" name="employee_id" value={emp.id} /><input type="hidden" name="idempotency_key" value={key} />
    <div className="rounded-xl bg-surface-2/70 p-4 ring-1 ring-inset ring-border/70">
      <div className="text-[12.5px] font-medium text-muted">Total owed to {emp.name} <span className="text-muted/80">· {emp.no}</span></div>
      <div className="mt-1 text-[28px] font-semibold tracking-[-0.03em]" data-pay-outstanding><Money value={emp.outstanding} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
        <div><dt className="text-muted">Earlier months</dt><dd className="font-medium"><Money value={emp.previous} /></dd></div>
        <div><dt className="text-muted">This month</dt><dd className="font-medium">{emp.current === null ? <span className="text-muted">Not posted yet</span> : <Money value={emp.currentDue} />}</dd></div>
      </dl>
    </div>
    <Field label="Amount (AED) *">
      <Input name="amount" type="number" inputMode="decimal" step="0.01" min="0.01" required value={amount} onChange={e => setAmount(e.target.value)} autoFocus className="text-[17px] font-semibold tabular-nums" />
    </Field>
    {quick.some(([, v]) => v > 0) && <div className="-mt-2 flex flex-wrap gap-1.5" aria-label="Fill in an amount">
      {quick.filter(([, v]) => v > 0).map(([l, v]) => <button key={l} type="button" onClick={() => setAmount(v.toFixed(2))}
        className={cn('min-h-8 cursor-pointer rounded-full border px-3 text-[12.5px] font-medium transition-colors', cents(n) === cents(v) ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted hover:text-fg')}>{l} · <Money value={v} currency={false} /></button>)}
    </div>}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Payment date *"><Input name="paid_on" type="date" defaultValue={today} max={today} required /></Field>
      <Field label="Paid by *"><Select name="method" defaultValue="cash" required>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Reference"><Input name="reference" maxLength={120} placeholder="Cheque or transfer no." /></Field>
      <Field label="Notes"><Input name="notes" maxLength={500} placeholder="Optional" /></Field>
    </div>
    {n > 0 && (plan.lines.length > 0 || plan.credit > 0) && <div className="rounded-lg border border-border/80 px-3.5 py-3 text-[13px]" data-pay-plan>
      <div className="mb-1.5 font-medium">This payment settles</div>
      <ul className="space-y-1">{plan.lines.map(l => <li key={l.label} className="flex justify-between gap-3"><span className="text-muted">{l.label}</span><Money value={l.amount} /></li>)}
        {plan.credit > 0 && <li className="flex justify-between gap-3 text-warning"><span>Paid in advance (credit)</span><Money value={plan.credit} /></li>}</ul>
    </div>}
    {emp.open.length > 1 && <details className="group rounded-lg border border-border/80 px-3.5 py-2.5 text-[13px]">
      <summary className="cursor-pointer select-none font-medium text-muted marker:text-muted group-open:mb-2 group-open:text-fg">Advanced: pay a specific month first</summary>
      <Field label="Settle first"><Select name="allocate_to" value={target} onChange={e => setTarget(e.target.value)}>
        <option value="">Oldest unpaid first (recommended)</option>
        {emp.open.map(o => <option key={o.id} value={o.id}>{periodLabel(o)} · AED {o.remaining.toFixed(2)} left</option>)}</Select></Field>
      <p className="mt-1.5 text-xs text-muted">Anything above what that month needs still goes to the oldest unpaid month.</p>
    </details>}
    {state?.error && <Alert tone="red">{state.error}</Alert>}
    <div className="form-actions flex justify-end gap-2 pt-1">
      <Button type="submit" disabled={pending || n <= 0} aria-busy={pending} className="h-11 w-full text-[15px] sm:w-auto">{pending && <Loader2 size={15} className="animate-spin" />}Confirm payment{n > 0 && <> · <Money value={n} /></>}</Button>
    </div>
  </form>
}
