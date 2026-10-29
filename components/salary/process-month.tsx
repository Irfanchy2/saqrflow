'use client'
import { useMemo, useState } from 'react'
import { postSalaryMonth } from '@/app/actions/salary'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { DialogButton } from '@/components/ui/dialog'
import { Alert, Money } from '@/components/ui/primitives'
import { CalendarCheck } from '@/components/icons'
import { cents, fromCents } from '@/lib/salary-math'

type Row = { id: string; name: string; no: string; salary: number; why: 'posted' | 'no_salary' | 'before_opening' | 'not_joined' | null }
const WHY: Record<string, string> = { posted: 'Already posted', no_salary: 'No monthly salary set', before_opening: 'Covered by the opening balance', not_joined: 'Joined later' }

/**
 * Preview, then confirm: posting adds each employee's monthly salary for the month to what they are owed. It is not a
 * payment. Months already posted are skipped (by the database too), so running it twice never doubles anything.
 */
export function ProcessMonth({ month, label, rows, future }: { month: string; label: string; rows: Row[]; future: boolean }) {
  const ready = rows.filter(r => !r.why)
  const [picked, setPicked] = useState(() => new Set(ready.map(r => r.id)))
  const total = useMemo(() => fromCents(ready.filter(r => picked.has(r.id)).reduce((s, r) => s + cents(r.salary), 0)), [ready, picked])
  const flip = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return <DialogButton label={`Post ${label} salary`} title={`Post salary for ${label}`} icon={<CalendarCheck size={15} aria-hidden />} variant="secondary" wide>
    {future ? <Alert tone="amber">{label} has not started yet. Salary can be posted for this month or earlier.</Alert> : <ActionForm action={postSalaryMonth} hideSubmit>
      <input type="hidden" name="month" value={month} />
      <p className="text-[13.5px] text-muted">Adds each person&apos;s monthly salary for {label} to what they are owed. Nothing is marked as paid: record payments separately, any time and in parts.</p>
      {!ready.length ? <Alert tone="green">{label} is already posted for everyone with a salary.</Alert> : <>
        <div className="flex items-center justify-between text-[13px]"><span className="font-medium">{picked.size} of {ready.length} selected</span>
          <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => setPicked(picked.size === ready.length ? new Set() : new Set(ready.map(r => r.id)))}>{picked.size === ready.length ? 'Clear all' : 'Select all'}</button></div>
        <ul className="max-h-[48dvh] divide-y divide-border overflow-y-auto rounded-lg border border-border" data-post-list>
          {ready.map(r => <li key={r.id}><label className="flex min-h-12 cursor-pointer items-center gap-3 px-3.5 py-2.5 hover:bg-surface-2/60">
            <input type="checkbox" name="employee_id" value={r.id} checked={picked.has(r.id)} onChange={() => flip(r.id)} className="h-[18px] w-[18px] accent-[hsl(var(--primary))]" />
            <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{r.name}</span><span className="text-xs text-muted">{r.no}</span></span>
            <Money value={r.salary} className="text-[14px] font-medium" /></label></li>)}
        </ul></>}
      {rows.some(r => r.why) && <details className="text-[13px]"><summary className="cursor-pointer text-muted">Not included ({rows.filter(r => r.why).length})</summary>
        <ul className="mt-2 space-y-1">{rows.filter(r => r.why).map(r => <li key={r.id} className="flex justify-between gap-3"><span>{r.name}</span><span className="text-muted">{WHY[r.why!]}{r.why === 'posted' && <> · <Money value={r.salary} /></>}</span></li>)}</ul></details>}
      {ready.length > 0 && <div className="form-actions flex items-center justify-between gap-3 border-t border-border/80 pt-3">
        <span className="text-[13px] text-muted">Total <b className="font-semibold text-fg"><Money value={total} /></b></span>
        <SubmitButton variant="primary">Confirm and post</SubmitButton></div>}
    </ActionForm>}
  </DialogButton>
}
