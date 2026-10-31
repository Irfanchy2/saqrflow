import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { AccountSelect } from '@/components/banking/account-select'
import { ArrowDownLeft, Banknote, HandCoins, Plus, Scale, Undo2 } from '@/components/icons'
import { adjustPettyCash, issuePettyCash, payReimbursement, recordPettyReturn, reversePettyEntry, settleClaim } from '@/app/actions/petty'
import { METHODS } from '@/lib/petty-math'
import { fmtMoney } from '@/lib/sales/money'

// Approver forms for Employee Petty Cash. Each posts through one database function, once per form (request key).
type Opt = { id: string; name: string }
const Method = ({ value = 'cash' }: { value?: string }) => <Field label="Payment method"><Select name="method" defaultValue={value}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
const Amount = ({ hint, max }: { hint?: string; max?: number }) => <Field label="Amount (AED) *" hint={hint}><Input name="amount" type="number" inputMode="decimal" step="0.01" min="0.01" max={max} required placeholder="0.00" /></Field>

/** Issue Petty Cash: an employee is handed money for company purchases. */
export function IssueButton({ today, employees, projects, employee, variant = 'primary', label = 'Issue petty cash' }: {
  today: string; employees?: Opt[]; projects: Opt[]; employee?: Opt; variant?: 'primary' | 'secondary' | 'ghost'; label?: string
}) {
  return <DialogButton variant={variant} openParam="issue" label={<><Plus size={15} aria-hidden />{label}</>} title={employee ? `Issue petty cash to ${employee.name}` : 'Issue petty cash'}>
    <ActionForm action={issuePettyCash} idempotent submit="Confirm money handed over">
      <div className="grid gap-4 sm:grid-cols-2">
        {employee ? <input type="hidden" name="employee_id" value={employee.id} />
          : <Field label="Employee *" className="sm:col-span-2"><Select name="employee_id" required defaultValue=""><option value="" disabled>Choose the employee</option>{(employees ?? []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>}
        <Amount />
        <Field label="Date handed over *"><Input name="entry_date" type="date" defaultValue={today} max={today} required /></Field>
        <Method />
        <AccountSelect name="paid_from_bank_id" label="Paid from (cash or bank account)" value={null} />
        <Field label="Purpose *" className="sm:col-span-2"><Input name="purpose" required maxLength={300} placeholder="e.g. Materials purchase for Site A" /></Field>
        <Field label="Project / site"><Select name="project_id" defaultValue=""><option value="">— General —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Payment reference"><Input name="reference" maxLength={120} placeholder="Voucher or transfer no." /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} maxLength={2000} /></Field>
      </div>
      <p className="mt-3 text-[13px] text-muted">Confirm only once the money has really been handed over. This is company money for business expenses: it is not salary and is never deducted from salary. When you choose the account it came from, that account&apos;s balance goes down once.</p>
    </ActionForm></DialogButton>
}

/** Record unused petty cash handed back to the company. */
export function ReturnButton({ today, employee, available }: { today: string; employee: Opt; available: number }) {
  return <DialogButton variant="secondary" label={<><ArrowDownLeft size={15} aria-hidden />Record return</>} title={`Unused petty cash returned by ${employee.name}`}>
    <ActionForm action={recordPettyReturn} idempotent submit="Confirm money received back">
      <input type="hidden" name="employee_id" value={employee.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Amount hint={`Holds AED ${fmtMoney(available)}`} max={available} />
        <Field label="Date returned *"><Input name="entry_date" type="date" defaultValue={today} max={today} required /></Field>
        <Method />
        <AccountSelect name="deposit_bank_id" label="Received into (cash or bank account)" value={null} />
        <Field label="Reference"><Input name="reference" maxLength={120} /></Field>
        <Field label="Notes"><Input name="notes" maxLength={2000} /></Field>
      </div></ActionForm></DialogButton>
}

/** Pay back what the company owes the employee for expenses paid with their own money (in full or in part). */
export function ReimburseButton({ today, employee, due }: { today: string; employee: Opt; due: number }) {
  return <DialogButton variant="secondary" label={<><Banknote size={15} aria-hidden />Pay reimbursement</>} title={`Reimburse ${employee.name}`}>
    <ActionForm action={payReimbursement} idempotent submit="Record payment">
      <input type="hidden" name="employee_id" value={employee.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Amount hint={`Owed AED ${fmtMoney(due)}`} max={due} />
        <Field label="Date paid *"><Input name="entry_date" type="date" defaultValue={today} max={today} required /></Field>
        <Method />
        <AccountSelect name="paid_from_bank_id" label="Paid from" value={null} />
        <Field label="Reference"><Input name="reference" maxLength={120} /></Field>
        <Field label="Notes"><Input name="notes" maxLength={2000} /></Field>
      </div>
      <p className="mt-3 text-[13px] text-muted">A reimbursement repays business expenses. It is kept apart from salary payments.</p></ActionForm></DialogButton>
}

/** An authorized correction of the wallet (with a reason). */
export function AdjustButton({ today, employee }: { today: string; employee: Opt }) {
  return <DialogButton variant="ghost" label={<><Scale size={15} aria-hidden />Adjust</>} title={`Adjust petty cash: ${employee.name}`}>
    <ActionForm action={adjustPettyCash} idempotent submit="Record adjustment">
      <input type="hidden" name="employee_id" value={employee.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Adjustment *"><Select name="direction" defaultValue="remove"><option value="remove">Take off the balance</option><option value="add">Add to the balance</option></Select></Field>
        <Amount />
        <Field label="Date *"><Input name="entry_date" type="date" defaultValue={today} max={today} required /></Field>
        <Field label="Reason *"><Input name="reason" required minLength={3} maxLength={250} placeholder="e.g. Cash count short" /></Field>
      </div>
      <p className="mt-3 text-[13px] text-muted">Use this only for authorized corrections. It cannot take the balance below zero, and it is shown on the statement with its reason.</p></ActionForm></DialogButton>
}

/** Reverse a posted entry: the entry stays; an opposite entry is added with the reason. */
export function ReverseButton({ id, employeeId, what }: { id: string; employeeId: string; what: string }) {
  return <DialogButton size="sm" variant="ghost" label={<><Undo2 size={14} aria-hidden /><span className="sr-only sm:not-sr-only">Reverse</span><span className="sr-only"> {what}</span></>} title={`Reverse: ${what}`}>
    <ActionForm action={reversePettyEntry} submit="Reverse" variant="danger">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="employee_id" value={employeeId} />
      <p className="text-[13.5px] text-muted">The entry stays on the statement and an opposite entry is added. If it moved company cash, that is reversed too. Record it again if it was entered wrongly.</p>
      <Field label="Reason *"><Textarea name="reason" required minLength={3} maxLength={250} placeholder="e.g. Entered twice" /></Field>
    </ActionForm></DialogButton>
}

/** Settle the rest of an approved expense: from petty cash and/or as money owed to the employee. */
export function SettleButton({ claimId, unsettled, available, label }: { claimId: string; unsettled: number; available: number; label: string }) {
  const pet = Math.min(unsettled, Math.max(0, available))
  return <DialogButton size="sm" variant="secondary" label={<><HandCoins size={14} aria-hidden />Settle</>} title={`Settle: ${label}`}>
    <ActionForm action={settleClaim.bind(null, claimId)} idempotent submit="Settle">
      <p className="mb-3 text-[13.5px]">AED {fmtMoney(unsettled)} of this approved expense is still to settle. The employee holds AED {fmtMoney(available)} of petty cash.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From petty cash (AED)" hint="Taken off the employee's balance"><Input name="petty" type="number" step="0.01" min="0" max={pet} defaultValue={pet ? pet.toFixed(2) : ''} /></Field>
        <Field label="Paid by the employee (AED)" hint="Only if you confirmed they paid it: owed back to them"><Input name="personal" type="number" step="0.01" min="0" max={unsettled} placeholder="0.00" /></Field>
      </div></ActionForm></DialogButton>
}
