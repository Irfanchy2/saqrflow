import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Alert, Badge, Card, CardHeader, EmptyState, Field, Input, LinkButton, Metrics, Money, PageHeader, Select, StatCard, Td, Textarea, Th } from '@/components/ui/primitives'
import { TableWrap } from '@/components/ui/table-wrap'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { Banknote, CalendarPlus, CircleDollarSign, Download, FileText, History, Pencil, Plus, Printer, Undo2, Wallet } from '@/components/icons'
import { WhatsAppSend } from '@/components/whatsapp/send'
import { addAdvance } from '@/app/actions/employees'
import { applyAdvance, editPayment, recordAdjustment, reverseSalaryItem, setOpeningBalance } from '@/app/actions/salary'
import { monthLong, movements, salaryAccount } from '@/lib/salary'
import { KIND_LABEL, METHODS, STATUS, methodLabel, periodLabel, splitOwed, statement, sum } from '@/lib/salary-math'
import { formatAed, formatShortDate, showDate } from '@/lib/time'
import { QuickPay } from '@/components/salary/quick-pay'

export const metadata = { title: 'Salary account' }
const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Reverse a payment or an entry: kept on the account, marked reversed, with the reason. */
function Reverse({ id, type, emp, what }: { id: string; type: 'payment' | 'entry'; emp: string; what: string }) {
  return <DialogButton size="sm" variant="ghost" label={<><Undo2 size={14} aria-hidden />Reverse<span className="sr-only"> {what}</span></>} title={`Reverse ${what}`}>
    <ActionForm action={reverseSalaryItem} submit="Reverse" variant="danger">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="type" value={type} /><input type="hidden" name="employee_id" value={emp} />
      <p className="text-[13.5px] text-muted">The entry stays on the account, marked reversed, and stops counting. {type === 'payment' ? 'The amount becomes owed again.' : 'Payments it had settled move to the next unpaid month.'} Record it again if it was entered wrongly.</p>
      <Field label="Reason *"><Textarea name="reason" required minLength={3} maxLength={500} placeholder="e.g. Entered twice" /></Field>
    </ActionForm></DialogButton>
}

export default async function SalaryAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('salary.view')) redirect('/')
  const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const sp = await flat(searchParams)
  const a = await salaryAccount(c, id); if (!a) notFound()
  const month = c.today.slice(0, 7), split = splitOwed(a.obligations, month)
  const cur = a.obligations.find(o => o.kind === 'accrual' && o.period === `${month}-01`)
  const open = a.obligations.filter(o => o.remaining > 0)
  const target = { id, name: a.emp.full_name, no: a.emp.employee_no, monthly: a.monthly, outstanding: a.account.outstanding, previous: split.previous, currentDue: split.current, current: cur ? cur.amount : null,
    open: open.map(({ id, kind, period, entry_date, remaining, reason }) => ({ id, kind, period, entry_date, remaining, reason })) }
  const moves = movements(a), dates = moves.map(m => m.date).sort(), first = dates[0] ?? c.today, last = dates[dates.length - 1] ?? c.today
  const from = isDay(sp.from) ? sp.from! : first, to = isDay(sp.to) ? sp.to! : last > c.today ? last : c.today   // by default, everything
  const st = statement(moves, from, to)
  const openAdv = a.advances.filter(x => x.kind === 'advance' && x.remaining > 0)
  const others = a.ledger.filter(e => e.kind !== 'accrual' && e.kind !== 'opening')
  const opening = a.ledger.find(e => e.kind === 'opening' && e.status === 'posted')
  const restWithoutOpening = a.account.outstanding - a.account.opening
  const totalAdded = sum([a.account.opening, a.account.accrued, a.account.additions])
  return <div className="mx-auto max-w-[1300px]">
    <PageHeader title={a.emp.full_name} sub={`${a.emp.employee_no}${a.emp.designation ? ` · ${a.emp.designation}` : ''} · Salary account`}
      crumbs={[{ label: 'Salary', href: '/salary' }, { label: a.emp.full_name }]}
      actions={<>
        <QuickPay emp={target} today={c.today} />
        <DialogButton variant="secondary" label={<><Plus size={15} aria-hidden />Adjustment</>} title="Record an adjustment">
          <ActionForm action={recordAdjustment} idempotent submit="Record">
            <input type="hidden" name="employee_id" value={id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type *"><Select name="type" defaultValue="addition"><option value="addition">Addition: owe more (bonus, overtime)</option><option value="deduction">Deduction: owe less (fine, damage, unpaid leave)</option></Select></Field>
              <Field label="Amount (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" required /></Field>
              <Field label="Date *"><Input name="entry_date" type="date" defaultValue={c.today} required /></Field>
              <Field label="For month (additions)"><Input name="period" type="month" defaultValue={month} /></Field></div>
            <Field label="Reason *"><Textarea name="reason" required minLength={3} maxLength={500} placeholder="e.g. Overtime, 12 hours in October" /></Field>
          </ActionForm></DialogButton>
        <LinkButton variant="secondary" href={`/employees/${id}`}>Employee profile</LinkButton>
      </>} />

    {!a.obligations.length && !a.payments.length && <Alert tone="blue">No salary is recorded yet. Set the opening balance if salary was already owed before you started using Averiqo, then post the month from the <Link className="font-medium underline" href="/salary">Salary</Link> page.</Alert>}
    {!a.obligations.length && a.payments.some(p => p.status === 'posted') && <div className="mb-4"><Alert tone="amber">Payments are recorded but no salary is posted for this person, so they show as paid in advance. Set the opening balance below (you can enter what is still owed today) so the balance is right.</Alert></div>}

    <Metrics className="mb-5" cols={4}>
      <StatCard index={0} label="Still owed" value={formatAed(a.account.outstanding)} hint={a.account.outstanding < 0 ? 'Paid in advance' : `Earlier months ${formatAed(split.previous)}`} icon={CircleDollarSign} tone={a.account.outstanding > 0 ? 'amber' : 'green'} />
      <StatCard index={1} label="Monthly salary" value={a.monthly === null ? 'Not set' : formatAed(a.monthly)} hint={cur ? `${monthLong(month)}: ${formatAed(split.current)} left` : `${monthLong(month)} not posted`} icon={CalendarPlus} />
      <StatCard index={2} label="Total salary owed so far" value={formatAed(totalAdded)} hint={`Opening ${formatAed(a.account.opening)} + salary ${formatAed(sum([a.account.accrued, a.account.additions]))}`} icon={Banknote} />
      <StatCard index={3} label="Total paid" value={formatAed(a.account.paid)} hint={a.account.deductions + a.account.offsets > 0 ? `+ ${formatAed(sum([a.account.deductions, a.account.offsets]))} deducted or recovered` : 'All payments'} icon={Wallet} />
    </Metrics>

    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-3" data-months><CardHeader title="Month by month" sub="Oldest first. Payments settle the oldest unpaid month unless you choose one." />
        {!a.obligations.length ? <EmptyState compact icon={CalendarPlus} title="No salary months yet" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Month</Th><Th className="text-end">Salary</Th><Th className="text-end">Paid</Th><Th className="text-end">Left</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="divide-y divide-border">{a.obligations.map(o => <tr key={o.id} data-month={o.kind === 'opening' ? 'opening' : (o.period ?? o.entry_date).slice(0, 7)}>
            <Td className="font-medium">{periodLabel(o)}{o.kind === 'opening' && <div className="text-xs font-normal text-muted">Owed before {showDate(o.entry_date)}</div>}</Td>
            <Td className="text-end"><Money value={o.amount} /></Td><Td className="text-end"><Money value={o.allocated} className={o.allocated ? '' : 'text-muted'} /></Td>
            <Td className="text-end font-semibold"><Money value={o.remaining} className={o.remaining ? '' : 'text-muted'} /></Td>
            <Td><Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge></Td>
            <Td className="text-end">{o.kind !== 'opening' && <Reverse id={o.id} type="entry" emp={id} what={periodLabel(o)} />}</Td></tr>)}</tbody></TableWrap>}
      </Card>

      <Card className="lg:col-span-2" data-opening><CardHeader title="Opening balance" sub="Salary already owed before your records in Averiqo start. Entered once; it is never repeated." />
        <div className="px-5 pb-5">
          <div className="mb-3 text-[26px] font-semibold tracking-[-0.02em]"><Money value={a.account.opening} /></div>
          <p className="mb-4 text-[13px] text-muted">{opening ? <>Owed before {showDate(opening.entry_date)}{opening.reason ? ` · ${opening.reason}` : ''}</> : 'No opening balance.'}</p>
          <DialogButton size="sm" variant="secondary" label={opening ? 'Change opening balance' : 'Set opening balance'} title="Opening balance">
            <ActionForm action={setOpeningBalance} submit="Save opening balance">
              <input type="hidden" name="employee_id" value={id} />
              <fieldset className="grid gap-2 text-[14px]"><legend className="mb-1 text-[13px] font-medium">What are you entering?</legend>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/50"><input type="radio" name="mode" value="before" defaultChecked className="mt-1" /><span><b className="font-medium">Owed before the records start</b><span className="block text-[12.5px] text-muted">Unpaid salary from before the date below. Salary months and payments in Averiqo are added and taken off on top.</span></span></label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/50"><input type="radio" name="mode" value="today" className="mt-1" /><span><b className="font-medium">Still owed today</b><span className="block text-[12.5px] text-muted">The opening balance is worked out from what is already recorded so the total comes to this amount. Recorded now: {formatAed(restWithoutOpening)} {restWithoutOpening < 0 ? '(more paid than posted)' : ''}.</span></span></label>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount (AED) *"><Input name="amount" type="number" step="0.01" min="0" required defaultValue={opening ? opening.amount : undefined} /></Field>
                <Field label="Records start on *"><Input name="as_of" type="date" required defaultValue={opening?.entry_date ?? (a.account.lastAccrual ? a.obligations.find(o => o.kind === 'accrual')?.period ?? `${month}-01` : `${month}-01`)} /></Field></div>
              <Field label={opening ? 'Reason for the change *' : 'Note'}><Textarea name="reason" required={!!opening} maxLength={500} placeholder={opening ? 'e.g. Corrected after checking the cash book' : 'e.g. Unpaid salary Jun–Sep 2026'} /></Field>
              <p className="text-xs text-muted">Salary months must start on or after this date, so nothing is counted twice. A change keeps the old amount on record, reversed, with your reason.</p>
            </ActionForm></DialogButton>
        </div></Card>
    </div>

    <Card className="mt-5" data-payments><CardHeader title="Payments" sub="Every payment is its own transaction. Pay as often as you need, in any amount." action={<QuickPay emp={target} today={c.today} label="Pay" size="sm" variant="secondary" />} />
      {!a.payments.length ? <EmptyState compact icon={Wallet} title="No payments yet" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Date</Th><Th className="text-end">Amount</Th><Th>Paid by</Th><Th>Settled</Th><Th>Reference</Th><Th>Recorded by</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
        <tbody className="divide-y divide-border">{a.payments.map(p => {
          const off = p.status !== 'posted', credit = p.amount - sum(p.allocations.map(x => x.amount))
          return <tr key={p.id} className={off ? 'opacity-60' : ''} data-payment={p.id}>
            <Td className="whitespace-nowrap">{showDate(p.paid_on ?? p.period)}</Td>
            <Td className="text-end font-semibold"><Money value={p.amount} className={off ? 'line-through' : ''} /></Td>
            <Td>{methodLabel(p.method)}</Td>
            <Td className="text-[13px]">{off ? <span className="text-muted">Reversed{p.reversal_reason ? `: ${p.reversal_reason}` : ''}</span> : <>{p.allocations.map(x => <div key={x.obligation.id}>{periodLabel(x.obligation)} <span className="text-muted">· <Money value={x.amount} /></span></div>)}{credit > 0.004 && <div className="text-success">Credit · <Money value={credit} /></div>}</>}
              {p.notes && <div className="text-xs text-muted">{p.notes}</div>}</Td>
            <Td className="text-muted">{p.reference ?? '—'}</Td>
            <Td className="text-[13px] text-muted">{p.by ?? '—'}<div className="text-xs">{formatShortDate(p.created_at.slice(0, 10))}</div></Td>
            <Td><Badge tone={off ? 'neutral' : 'green'}>{off ? 'Reversed' : 'Posted'}</Badge></Td>
            <Td className="text-end"><div className="flex flex-wrap justify-end gap-1">
              <LinkButton href={`/api/payslips/${p.id}?view=1`} target="_blank" variant="ghost" size="sm"><Printer size={14} aria-hidden />Receipt<span className="sr-only"> {showDate(p.paid_on ?? p.period)}</span></LinkButton>
              <LinkButton href={`/api/payslips/${p.id}`} variant="ghost" size="sm"><Download size={14} aria-hidden /><span className="sr-only">Download receipt {showDate(p.paid_on ?? p.period)}</span></LinkButton>
              {!off && c.can('records.edit') && <WhatsAppSend kind="payslip" recordId={p.id} label="Receipt" ariaLabel={`Send the ${showDate(p.paid_on ?? p.period)} salary receipt via WhatsApp`} variant="ghost" />}
              {!off && <DialogButton size="sm" variant="ghost" label={<><Pencil size={14} aria-hidden /><span className="sr-only">Edit payment {showDate(p.paid_on ?? p.period)}</span></>} title="Edit payment details">
                <ActionForm action={editPayment} resetOnSuccess={false}>
                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="employee_id" value={id} />
                  <p className="text-[13px] text-muted">The amount (<Money value={p.amount} />) cannot change. To correct it, reverse this payment and record the right amount.</p>
                  <div className="grid gap-4 sm:grid-cols-2"><Field label="Payment date *"><Input name="paid_on" type="date" max={c.today} defaultValue={p.paid_on ?? p.period} required /></Field>
                    <Field label="Paid by *"><Select name="method" defaultValue={p.method ?? 'cash'}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                    <Field label="Reference"><Input name="reference" maxLength={120} defaultValue={p.reference ?? ''} /></Field>
                    <Field label="Notes"><Input name="notes" maxLength={500} defaultValue={p.notes ?? ''} /></Field></div>
                </ActionForm></DialogButton>}
              {!off && <Reverse id={p.id} type="payment" emp={id} what={`payment of ${formatAed(p.amount)}`} />}
            </div></Td></tr>
        })}</tbody></TableWrap>}
    </Card>

    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Card data-advances><CardHeader title="Advances" sub="Kept apart from salary. Recover one from salary when you agree to." action={<div className="flex gap-1.5">
        {openAdv.length > 0 && <DialogButton size="sm" variant="secondary" label="Recover from salary" title="Recover an advance from salary">
          <ActionForm action={applyAdvance} idempotent submit="Recover">
            <input type="hidden" name="employee_id" value={id} />
            <p className="text-[13.5px] text-muted">Reduces both what is owed to {a.emp.full_name.split(' ')[0]} and what they still have to repay, by the same amount. Salary owed now: <Money value={a.account.outstanding} />.</p>
            <Field label="Advance *"><Select name="advance_id" required>{openAdv.map(x => <option key={x.id} value={x.id}>{showDate(x.given_on)} · {formatAed(x.remaining)} left of {formatAed(x.amount)}</option>)}</Select></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Amount (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" required defaultValue={openAdv[0].monthly_recovery ?? openAdv[0].remaining} /></Field>
              <Field label="Date *"><Input name="entry_date" type="date" defaultValue={c.today} required /></Field></div>
          </ActionForm></DialogButton>}
        <DialogButton size="sm" variant="ghost" label={<><Plus size={14} aria-hidden />Advance</>} title="Give an advance">
          <ActionForm action={addAdvance.bind(null, id)} idempotent><input type="hidden" name="kind" value="advance" />
            <p className="text-[13px] text-muted">An advance is money the employee owes back. It does not change their salary until you recover it.</p>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Amount (AED) *"><Input type="number" step="0.01" min="0.01" name="amount" required /></Field>
              <Field label="Date"><Input type="date" name="given_on" defaultValue={c.today} /></Field><Field label="Recover per month"><Input type="number" step="0.01" min="0" name="monthly_recovery" /></Field></div>
            <Field label="Notes"><Textarea name="notes" /></Field></ActionForm></DialogButton></div>} />
        {!a.advances.length ? <EmptyState compact icon={Banknote} title="No advances" /> : <ul className="divide-y divide-border">{a.advances.map(x => <li key={x.id} className="flex items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{x.kind === 'advance' ? 'Advance' : 'Deduction (recorded with advances)'} · {showDate(x.given_on)}</div>
            <div className="text-[12.5px] text-muted">{x.kind === 'advance' ? <>Recovered <Money value={x.recovered} /> · {x.monthly_recovery ? <>planned <Money value={x.monthly_recovery} /> a month</> : 'no plan'}</> : x.notes ?? ''}</div></div>
          <div className="text-end"><Money value={x.amount} className="font-semibold" />{x.kind === 'advance' && <div><Badge tone={x.remaining > 0 ? 'amber' : 'green'}>{x.remaining > 0 ? `${formatAed(x.remaining)} to repay` : 'Repaid'}</Badge></div>}</div></li>)}</ul>}
      </Card>

      <Card data-other><CardHeader title="Additions, deductions and recoveries" sub="Each with its reason. Reverse one to undo it." />
        {!others.length ? <EmptyState compact icon={FileText} title="None recorded" /> : <ul className="divide-y divide-border">{others.map(e => <li key={e.id} className={`flex items-center gap-3 px-5 py-3 ${e.status !== 'posted' ? 'opacity-60' : ''}`}>
          <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{e.kind === 'adjustment' && e.amount > 0 ? 'Addition' : KIND_LABEL[e.kind]} · {showDate(e.entry_date)}</div>
            <div className="truncate text-[12.5px] text-muted">{e.status !== 'posted' ? `Reversed: ${e.reversal_reason}` : e.reason ?? (e.kind === 'advance_offset' ? 'Taken from salary owed' : '')}</div></div>
          <Money value={e.kind === 'adjustment' && e.amount > 0 ? e.amount : -Math.abs(e.amount)} className={`font-semibold ${e.status !== 'posted' ? 'line-through' : ''}`} />
          {e.status === 'posted' && <Reverse id={e.id} type="entry" emp={id} what={KIND_LABEL[e.kind].toLowerCase()} />}</li>)}</ul>}
      </Card>
    </div>

    <Card className="mt-5" id="statement" data-statement><CardHeader title="Statement" sub="Opening balance, salary, payments, adjustments and deductions, with the balance after each." action={<div className="flex gap-1">
      <LinkButton size="sm" variant="ghost" target="_blank" href={`/api/salary-statements/${id}?from=${from}&to=${to}&view=1`}><Printer size={14} aria-hidden />Print</LinkButton>
      <LinkButton size="sm" variant="secondary" href={`/api/salary-statements/${id}?from=${from}&to=${to}`}><Download size={14} aria-hidden />PDF</LinkButton></div>} />
      <form className="flex flex-wrap items-end gap-2 px-5 pb-3" action={`/salary/${id}#statement`}>
        <Field label="From"><Input name="from" type="date" defaultValue={from} /></Field><Field label="To"><Input name="to" type="date" defaultValue={to} /></Field>
        <button className="h-10 cursor-pointer rounded-full border border-border bg-surface px-4 text-[13px] font-medium shadow-key hover:bg-surface-2">Show</button></form>
      <TableWrap><thead className="border-b border-border"><tr><Th>Date</Th><Th>Description</Th><Th className="text-end">Owed</Th><Th className="text-end">Paid / taken off</Th><Th className="text-end">Balance</Th></tr></thead>
        <tbody className="divide-y divide-border">
          <tr className="bg-surface-2/50"><Td>{showDate(from)}</Td><Td className="font-medium">Balance brought forward</Td><Td /><Td /><Td className="text-end font-semibold"><Money value={st.brought} /></Td></tr>
          {st.rows.map(r => <tr key={r.id}><Td className="whitespace-nowrap">{showDate(r.date)}</Td><Td>{r.label}{r.ref && <span className="text-muted"> · {r.ref}</span>}</Td>
            <Td className="text-end">{r.amount >= 0 ? <Money value={r.amount} /> : ''}</Td><Td className="text-end">{r.amount < 0 ? <Money value={-r.amount} /> : ''}</Td><Td className="text-end font-medium"><Money value={r.balance} /></Td></tr>)}
          <tr className="bg-surface-2/50"><Td>{showDate(to)}</Td><Td className="font-semibold">Owed at the end of the period</Td><Td className="text-end"><Money value={st.added} /></Td><Td className="text-end"><Money value={st.settled} /></Td><Td className="text-end font-semibold"><span data-closing><Money value={st.closing} /></span></Td></tr>
        </tbody></TableWrap>
    </Card>

    <Card className="mt-5" data-history><CardHeader title="History" sub="Who posted, changed or reversed what, and why." />
      {!a.history.length ? <EmptyState compact icon={History} title="Nothing yet" /> : <ul className="divide-y divide-border">{a.history.map(h => <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5 text-[13.5px]">
        <span className="font-medium">{h.action === 'posted' ? (h.payment_id ? 'Payment recorded' : 'Entry posted') : h.action === 'reversed' ? (h.payment_id ? 'Payment reversed' : 'Entry reversed') : 'Payment details edited'}</span>
        {h.reason && <span className="text-muted">“{h.reason}”</span>}<span className="ms-auto text-[12.5px] text-muted">{h.by ?? 'System'} · {new Date(h.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></li>)}</ul>}
    </Card>
  </div>
}
