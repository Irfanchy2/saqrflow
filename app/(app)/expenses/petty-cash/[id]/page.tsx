import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Badge, Card, CardHeader, EmptyState, LinkButton, Metrics, Money, PageHeader, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { Download, FileText, HandCoins, Wallet } from '@/components/icons'
import { ShareSheet } from '@/components/whatsapp/share-sheet'
import { AdjustButton, IssueButton, ReimburseButton, ReturnButton, ReverseButton, SettleButton } from '@/components/petty/forms'
import { canManagePetty, walletOf } from '@/lib/petty'
import { FUNDED_ADMIN, KIND, REQUEST_STATUS, kindLabel, methodLabel, statement, statementRange, type PettyKind } from '@/lib/petty-math'
import { formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Petty cash wallet' }
const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** One employee's petty cash wallet: balance, statement with running balance, reports, settlements and reimbursements. */
export default async function PettyWalletPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx()
  const manage = canManagePetty(c)
  if (!manage && !c.can('finance.view')) redirect('/')
  const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const sp = await flat(searchParams)
  const [a, { data: projects }] = await Promise.all([walletOf(c, id), c.supabase.from('projects').select('id,name').order('name').limit(500)])
  if (!a) notFound()
  const w = a.wallet, emp = { id, name: a.emp.full_name }
  const def = statementRange(a.entries, c.today)
  const from = isDay(sp.from) ? sp.from! : def.from, to = isDay(sp.to) ? sp.to! : def.to
  const st = statement(a.entries, from, to)
  const reversed = new Set(a.entries.filter(e => e.reverses_id).map(e => e.reverses_id as string))
  const pdf = `/api/petty-cash/${id}/statement?${new URLSearchParams({ from, to })}`
  const reqs = a.requests.filter((r: any) => r.status !== 'withdrawn')

  return <div className="mx-auto max-w-[1300px]">
    <PageHeader title={a.emp.full_name} sub={`${a.emp.employee_no}${a.emp.designation ? ` · ${a.emp.designation}` : ''} · Employee petty cash`}
      crumbs={[{ label: 'Expenses', href: '/expenses' }, { label: 'Petty cash', href: '/expenses?tab=petty' }, { label: a.emp.full_name }]}
      actions={<>
        {manage && <IssueButton today={c.today} projects={projects ?? []} employee={emp} />}
        {manage && w.available > 0 && <ReturnButton today={c.today} employee={emp} available={w.available} />}
        {manage && w.reimbursement_due > 0 && <ReimburseButton today={c.today} employee={emp} due={w.reimbursement_due} />}
        {manage && <AdjustButton today={c.today} employee={emp} />}
      </>} />

    <Metrics className="mb-5" cols={4}>
      <StatCard label="Available petty cash" value={<Money value={w.available} />} icon={Wallet} tone="blue" hint={w.pending_expenses > 0 ? `AED ${w.pending_expenses.toFixed(2)} in expenses waiting for approval` : 'Confirmed entries only'} />
      <StatCard label="Received" value={<Money value={w.received} />} hint={w.pending_received > 0 ? `AED ${w.pending_received.toFixed(2)} waiting for confirmation` : 'Confirmed hand-overs'} />
      <StatCard label="Expenses settled" value={<Money value={w.settled} />} hint={w.returned > 0 ? `Returned AED ${w.returned.toFixed(2)}` : 'From petty cash'} />
      <StatCard label="Reimbursement due" value={<Money value={w.reimbursement_due} />} icon={HandCoins} tone={w.reimbursement_due > 0 ? 'amber' : 'neutral'} hint={w.reimbursed > 0 ? `Paid back AED ${w.reimbursed.toFixed(2)}` : 'Expenses paid with own money'} />
    </Metrics>

    {a.awaiting.length > 0 && <Card className="mb-5" data-petty-awaiting><CardHeader title="Approved expenses waiting for settlement" sub="The employee did not hold enough petty cash when these were approved." />
      <ul className="divide-y divide-border">{a.awaiting.map(x => <li key={x.claim_id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{x.claim?.supplier_name ?? x.claim?.description ?? 'Expense'}</span>
          <span className="block text-xs text-muted">{x.claim?.spent_on ? formatShortDate(x.claim.spent_on) : ''} · {FUNDED_ADMIN[x.funded_by] ?? ''} · total AED {x.total.toFixed(2)} · settled AED {(x.from_petty_cash + x.to_reimburse).toFixed(2)}</span></span>
        <span className="text-[13px] font-medium text-warning">AED {x.unsettled.toFixed(2)} to settle</span>
        {manage && <SettleButton claimId={x.claim_id} unsettled={x.unsettled} available={w.available} label={x.claim?.supplier_name ?? x.claim?.description ?? 'Expense'} />}</li>)}</ul></Card>}

    <Card className="mb-5" data-petty-statement>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div><h2 className="text-[16px] font-semibold tracking-[-0.01em]">Petty cash statement</h2><p className="text-[13px] text-muted">{formatShortDate(from)} to {formatShortDate(to)} · opening <Money value={st.opening} /> · closing <Money value={st.closing} className="font-semibold text-fg" /></p></div>
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex items-center gap-2"><input type="date" name="from" defaultValue={from} aria-label="From" className="h-9 rounded-md border border-border bg-surface px-2 text-sm" /><input type="date" name="to" defaultValue={to} aria-label="To" className="h-9 rounded-md border border-border bg-surface px-2 text-sm" />
            <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Show</button></form>
          <LinkButton href={`${pdf}&view=1`} target="_blank" variant="ghost"><FileText size={14} aria-hidden />View PDF</LinkButton>
          <LinkButton href={pdf} variant="secondary"><Download size={14} aria-hidden />Download</LinkButton>
          {manage && <ShareSheet kind="petty_cash_statement" recordId={id} variant="ghost" label="Share" />}</div></div>
      {!a.entries.length ? <EmptyState icon={Wallet} compact title="No petty cash yet" body={manage ? 'Issue petty cash to start this wallet.' : undefined} />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Type</Th><Th>Description</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th><Th className="text-right">Balance</Th>{manage && <Th />}</tr></thead>
          <tbody className="divide-y divide-border">
            <tr className="bg-surface-2/30"><Td /><Td className="text-muted">Opening balance</Td><Td /><Td /><Td /><Td className="text-right font-medium tabular-nums"><Money value={st.opening} /></Td>{manage && <Td />}</tr>
            {st.rows.map(r => { const e = a.entries.find(x => x.id === r.id)!
              return <tr key={r.id} className={cn('hover:bg-surface-2/50', reversed.has(r.id) && 'text-muted')} data-petty-row={e.kind}>
                <Td className="whitespace-nowrap tabular-nums">{formatShortDate(r.date)}</Td>
                <Td><Badge tone={KIND[e.kind as PettyKind].tone}>{r.label}</Badge>{reversed.has(r.id) && <span className="ms-1.5 text-[12px]">reversed</span>}</Td>
                <Td><div className="max-w-[360px] [overflow-wrap:anywhere]">{r.detail}</div><div className="text-xs text-muted">{[r.reference, e.project?.name, e.method && methodLabel(e.method), e.bank && `${e.bank.name}`, e.creator?.full_name && `by ${e.creator.full_name}`].filter(Boolean).join(' · ')}</div></Td>
                <Td className="text-right tabular-nums">{r.in ? <Money value={r.in} /> : ''}</Td><Td className="text-right tabular-nums">{r.out ? <Money value={r.out} /> : ''}</Td>
                <Td className="text-right font-medium tabular-nums"><Money value={r.balance} /></Td>
                {manage && <Td className="text-right">{e.kind !== 'reversal' && !reversed.has(r.id) && <ReverseButton id={r.id} employeeId={id} what={`${r.label} of ${formatShortDate(r.date)}`} />}</Td>}</tr> })}
            <tr className="bg-surface-2/30"><Td /><Td className="font-semibold">Closing balance</Td><Td className="text-[12.5px] text-muted">Received <Money value={st.received} /> · settled <Money value={st.settled} /> · returned <Money value={st.returned} />{st.adjustments ? <> · adjustments <Money value={st.adjustments} /></> : null}</Td><Td /><Td /><Td className="text-right font-semibold tabular-nums"><Money value={st.closing} /></Td>{manage && <Td />}</tr>
          </tbody></TableWrap>}
    </Card>

    {(st.reimbursements.length > 0 || w.reimbursement_due > 0) && <Card className="mb-5" data-petty-reimbursements><CardHeader title="Reimbursements" sub={`Expenses paid with the employee's own money, and what was paid back. Owed now: AED ${w.reimbursement_due.toFixed(2)}.`} />
      <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Type</Th><Th>Description</Th><Th className="text-right">Amount</Th>{manage && <Th />}</tr></thead>
        <tbody className="divide-y divide-border">{st.reimbursements.map(r => { const e = a.entries.find(x => x.id === r.id)!
          return <tr key={r.id} className={cn(reversed.has(r.id) && 'text-muted')}><Td className="whitespace-nowrap tabular-nums">{formatShortDate(r.date)}</Td><Td><Badge tone={KIND[e.kind as PettyKind].tone}>{r.label}</Badge></Td>
            <Td className="[overflow-wrap:anywhere]">{r.detail}</Td><Td className="text-right tabular-nums">{r.amount > 0 ? '+' : '−'}<Money value={Math.abs(r.amount)} /></Td>
            {manage && <Td className="text-right">{e.kind !== 'reversal' && !reversed.has(r.id) && <ReverseButton id={r.id} employeeId={id} what={`${r.label} of ${formatShortDate(r.date)}`} />}</Td>}</tr> })}</tbody></TableWrap></Card>}

    <Card data-petty-reports><CardHeader title="Reports from the employee" sub="Petty cash received and returns the employee reported. The balance changes only once confirmed." />
      {!reqs.length ? <EmptyState compact icon={Wallet} title="No reports" />
        : <ul className="divide-y divide-border">{reqs.map((r: any) => <li key={r.id}><Link href={`/expenses?tab=petty&view=requests&open=${r.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-surface-2/50">
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.kind === 'received' ? 'Petty cash received' : 'Return of unused petty cash'}{r.linked ? ' · matched to a recorded hand-over' : ''}</span>
            <span className="block truncate text-xs text-muted">{formatShortDate(r.entry_date)}{r.counterparty ? ` · ${r.counterparty}` : ''}{r.purpose ? ` · ${r.purpose}` : ''}{r.decision_note ? ` · “${r.decision_note}”` : ''}</span></span>
          <Money value={r.amount} className="shrink-0 font-semibold" /><Badge tone={REQUEST_STATUS[r.status]?.tone} className="shrink-0">{REQUEST_STATUS[r.status]?.label}</Badge></Link></li>)}</ul>}</Card>
    <p className="mt-4 text-[12.5px] text-muted">Employee petty cash is company money for business expenses. It is kept apart from salary, salary advances and payslips, and is never deducted from salary.</p>
  </div>
}
