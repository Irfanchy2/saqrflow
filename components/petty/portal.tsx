import Link from 'next/link'
import type { Ctx } from '@/lib/auth'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { Field, Input, Money, Select, Textarea } from '@/components/ui/primitives'
import { ArrowDownLeft, ChevronRight, Plus, Wallet } from '@/components/icons'
import { reportPettyCash, updatePettyReport, withdrawPettyReport } from '@/app/actions/petty'
import { METHODS } from '@/lib/petty-math'
import { fmtMoney } from '@/lib/sales/money'
import { emptyWallet, type WalletRow } from '@/lib/petty'
import { Attachment } from './forms'
import { attachmentUrl } from '@/lib/petty-math'

// Employee Portal side of Employee Petty Cash: the employee's own wallet and the two reports they can make. Reports are
// pending until an approver confirms them; the wallet balance only ever comes from confirmed ledger entries.

export async function myWallet(c: Ctx, employeeId: string): Promise<WalletRow> {
  const { data } = await c.supabase.from('petty_cash_wallets').select('*').eq('employee_id', employeeId).maybeSingle()
  if (!data) return emptyWallet(employeeId)
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, k === 'employee_id' || k === 'last_entry' ? v : Number(v ?? 0)])) as WalletRow
}

type P = { id: string; name: string }
function ReportFields({ kind, today, projects, r }: { kind: 'received' | 'return'; today: string; projects: P[]; r?: any }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label={kind === 'received' ? 'Amount received (AED) *' : 'Amount returned (AED) *'}><Input name="amount" type="number" inputMode="decimal" step="0.01" min="0.01" required defaultValue={r?.amount ?? ''} placeholder="0.00" /></Field>
    <Field label={kind === 'received' ? 'Date received *' : 'Date returned *'}><Input name="entry_date" type="date" max={today} defaultValue={r?.entry_date ?? today} required /></Field>
    <Field label={kind === 'received' ? 'Received from *' : 'Handed to'}><Input name="counterparty" maxLength={200} required={kind === 'received'} defaultValue={r?.counterparty ?? ''} placeholder={kind === 'received' ? 'e.g. Mr. Rafi (Admin)' : 'Who took the money'} /></Field>
    <Field label="Payment method"><Select name="method" defaultValue={r?.method ?? 'cash'}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    {kind === 'received' && <Field label="Purpose"><Input name="purpose" maxLength={300} defaultValue={r?.purpose ?? ''} placeholder="e.g. Site materials" /></Field>}
    {kind === 'received' && projects.length > 0 && <Field label="Project / site"><Select name="project_id" defaultValue={r?.project_id ?? ''}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
    <Field label="Reference" hint="Voucher or transfer number, if any"><Input name="reference" maxLength={120} defaultValue={r?.reference ?? ''} /></Field>
    <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} maxLength={2000} defaultValue={r?.notes ?? ''} /></Field>
    {r?.document_id && <a href={attachmentUrl(r.document_id)} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-primary hover:underline sm:col-span-2">Open the attached file</a>}
    <Attachment className="sm:col-span-2" />
  </div>
}

/** "Add Petty Cash Received": the employee reports money handed to them for company purchases. */
export function ReportReceived({ today, projects, variant = 'secondary' }: { today: string; projects: P[]; variant?: 'primary' | 'secondary' }) {
  return <DialogButton variant={variant} openParam="received" label={<><Plus size={15} aria-hidden />Add petty cash received</>} title="Petty cash received">
    <ActionForm action={reportPettyCash} idempotent submit="Send for approval">
      <input type="hidden" name="kind" value="received" />
      <ReportFields kind="received" today={today} projects={projects} />
      <p className="mt-3 text-[12.5px] text-muted">Your balance changes only after the admin confirms the money was handed over. If the admin already recorded it, it is matched, not counted twice.</p>
    </ActionForm></DialogButton>
}

/** "Return Unused Petty Cash": the employee hands back money they did not spend. */
export function ReportReturn({ today, available }: { today: string; available: number }) {
  return <DialogButton variant="secondary" openParam="return" label={<><ArrowDownLeft size={15} aria-hidden />Return unused petty cash</>} title="Return unused petty cash">
    <ActionForm action={reportPettyCash} idempotent submit="Send for confirmation">
      <input type="hidden" name="kind" value="return" />
      <p className="mb-3 text-[13.5px]">You hold <b className="font-semibold">AED {fmtMoney(available)}</b>. You can return part or all of it.</p>
      <ReportFields kind="return" today={today} projects={[]} />
      <p className="mt-3 text-[12.5px] text-muted">Your balance goes down once the admin confirms they received the money.</p>
    </ActionForm></DialogButton>
}

export function EditReport({ r, today, projects }: { r: any; today: string; projects: P[] }) {
  return <div className="flex flex-wrap gap-2">
    <DialogButton size="sm" variant="secondary" label={r.status === 'correction_requested' ? 'Correct' : 'Change'} title={r.kind === 'received' ? 'Petty cash received' : 'Return of unused petty cash'}>
      <ActionForm action={updatePettyReport.bind(null, r.id)} submit="Save and send again" resetOnSuccess={false}>
        {r.decision_note && <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">Admin: “{r.decision_note}”</p>}
        <ReportFields kind={r.kind} today={today} projects={projects} r={r} /></ActionForm></DialogButton>
    <ActionButton variant="ghost" action={withdrawPettyReport.bind(null, r.id)} confirm="Withdraw this report?">Withdraw</ActionButton></div>
}

/**
 * Petty cash card for Home and My expenses, always shown: the balance (AED 0.00 until the company gives some), what is
 * waiting, and the two things an employee does most: report money received, and open the full petty cash page.
 */
export function WalletCard({ w, today, projects }: { w: WalletRow; today: string; projects: P[] }) {
  return <section data-petty-card className="overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-card">
    <Link href="/me/expenses/petty-cash" className="flex items-center gap-3 p-4 transition-colors hover:bg-surface-2/40">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" aria-hidden><Wallet size={22} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-muted">Available petty cash</span>
        <span className="block text-[22px] font-semibold leading-tight tracking-[-0.03em] tabular-nums" data-petty-available><Money value={w.available} /></span>
        <span className="block truncate text-[12.5px] text-muted">{[w.pending_requests > 0 && `${w.pending_requests} waiting for confirmation`, w.reimbursement_due > 0 && `AED ${fmtMoney(w.reimbursement_due)} to be paid back to you`].filter(Boolean).join(' · ') || 'Company money for business expenses'}</span></span>
      <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden /></Link>
    <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3" data-petty-card-actions>
      <ReportReceived today={today} projects={projects} />
      <Link href="/me/expenses/petty-cash" className="inline-flex h-10 items-center rounded-lg px-3 text-[14px] font-medium text-primary hover:bg-primary-soft">Open petty cash</Link>
    </div>
  </section>
}
