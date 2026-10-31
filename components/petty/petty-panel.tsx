import Link from 'next/link'
import type { Ctx } from '@/lib/auth'
import { Alert, Badge, EmptyState, Field, LinkButton, Money, Textarea, Td, Th, TableWrap } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { AccountSelect } from '@/components/banking/account-select'
import { FilterTabs } from '@/components/ui/mobile'
import { ChevronRight, Download, Link2, Wallet, X } from '@/components/icons'
import { decidePettyRequest } from '@/app/actions/petty'
import { canManagePetty, ENTRY_COLS, REQUEST_COLS, wallets } from '@/lib/petty'
import { FUNDED_ADMIN, KIND, REQUEST_STATUS, kindLabel, matchHandovers, methodLabel, type PettyKind } from '@/lib/petty-math'
import { formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { IssueButton, SettleButton } from './forms'

const UUID = /^[0-9a-f-]{36}$/i
const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
const VIEWS = [['overview', 'Overview'], ['requests', 'To confirm'], ['wallets', 'Wallets'], ['transactions', 'Transactions']] as const

/**
 * Employee Petty Cash, approvers' side (Expenses → Petty cash): what employees hold, reports waiting for confirmation,
 * approved expenses waiting for settlement, every wallet and every transaction. Company money for business expenses
 * only: nothing here touches salary or payroll.
 */
export async function PettyPanel({ c, sp, projects }: { c: Ctx; sp: Record<string, string | undefined>; projects: { id: string; name: string }[] }) {
  const manage = canManagePetty(c)
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : 'overview'
  const [w, { data: emps }, { data: pending }, focusRes, { data: awaitRows }, { data: pendingClaims }] = await Promise.all([
    wallets(c),
    c.supabase.from('employees').select('id,full_name,employee_no,status,user_id').neq('status', 'archived').order('full_name').limit(2000),
    c.supabase.from('petty_cash_requests').select(REQUEST_COLS).eq('status', 'pending').order('created_at').limit(300),
    sp.open && UUID.test(sp.open) ? c.supabase.from('petty_cash_requests').select(REQUEST_COLS).eq('id', sp.open).maybeSingle() : Promise.resolve({ data: null }),
    c.supabase.from('expense_claim_settlement').select('claim_id,employee_id,funded_by,total,unsettled').eq('status', 'approved').gt('unsettled', 0).limit(300),
    c.supabase.from('expense_claims').select('id,amount,vat_amount').eq('status', 'pending').eq('funded_by', 'petty_cash').limit(5000),
  ])
  const name = new Map((emps ?? []).map(e => [e.id, e])), nm = (id: string) => name.get(id)?.full_name ?? 'Employee'
  const sum = (k: keyof (typeof w)[number]) => w.reduce((s, r) => s + Number(r[k] ?? 0), 0)
  const avail = new Map(w.map(r => [r.employee_id, r.available]))
  const base = (x: Record<string, string>) => `/expenses?${new URLSearchParams({ tab: 'petty', ...x })}`
  const f: any = focusRes.data

  // possible matches for a "money received" report: hand-overs the company already recorded for this employee
  let matches: ReturnType<typeof matchHandovers> = []
  if (f && f.kind === 'received' && f.status === 'pending') {
    const [{ data: rec }, { data: taken }, { data: rev }] = await Promise.all([
      c.supabase.from('petty_cash_entries').select('id,kind,amount,entry_date,reference,description').eq('employee_id', f.employee_id).eq('kind', 'received').limit(1000),
      c.supabase.from('petty_cash_requests').select('entry_id').eq('employee_id', f.employee_id).eq('status', 'approved').not('entry_id', 'is', null).limit(1000),
      c.supabase.from('petty_cash_entries').select('reverses_id').eq('employee_id', f.employee_id).eq('kind', 'reversal').limit(1000),
    ])
    matches = matchHandovers(f, rec ?? [], new Set((taken ?? []).map(t => t.entry_id as string)), new Set((rev ?? []).map(r => r.reverses_id as string)))
  }
  const claimIds = (awaitRows ?? []).map(a => a.claim_id)
  const { data: awaitClaims } = claimIds.length ? await c.supabase.from('expense_claims').select('id,spent_on,description,supplier_name').in('id', claimIds) : { data: [] as any[] }
  const awaiting = (awaitRows ?? []).map(a => ({ ...a, claim: (awaitClaims ?? []).find((x: any) => x.id === a.claim_id) as any }))

  const tabs = <FilterTabs label="Petty cash views" className="px-3" tabs={VIEWS.map(([k, l]) => ({ href: k === 'overview' ? base({}) : base({ view: k }), label: l, active: view === k, count: k === 'requests' ? (pending ?? []).length : undefined }))} />
  const empOpts = (emps ?? []).map(e => ({ id: e.id, name: `${e.full_name} · ${e.employee_no}` }))
  const reqRow = (r: any) => <li key={r.id}><Link href={base({ view: 'requests', open: r.id })} scroll={false} data-petty-request={r.id}
    className={cn('flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2/50', sp.open === r.id && 'bg-primary-soft/40')}>
    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', r.kind === 'received' ? 'bg-success/10 text-success' : 'bg-primary-soft text-primary')}><Wallet size={16} aria-hidden /></span>
    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{nm(r.employee_id)} · {r.kind === 'received' ? 'Petty cash received' : 'Return of unused petty cash'}</span>
      <span className="block truncate text-xs text-muted">{formatShortDate(r.entry_date)}{r.counterparty ? ` · from ${r.counterparty}` : ''}{r.purpose ? ` · ${r.purpose}` : ''}{r.reference ? ` · ${r.reference}` : ''}</span></span>
    <Money value={r.amount} className="shrink-0 font-semibold" /><Badge tone={REQUEST_STATUS[r.status]?.tone} className="hidden shrink-0 sm:inline-flex">{REQUEST_STATUS[r.status]?.label}</Badge></Link></li>

  const detail = f && <section className="border-b border-border bg-surface-2/30 p-4 sm:p-5" data-petty-detail={f.id}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-[13px] text-muted">{nm(f.employee_id)} · reported {formatShortDate(f.created_at.slice(0, 10))}</p>
        <h2 className="mt-0.5 text-[18px] font-semibold tracking-[-0.02em]">{f.kind === 'received' ? 'Petty cash received' : 'Return of unused petty cash'}: <Money value={f.amount} /></h2></div>
      <div className="flex items-center gap-2"><Badge tone={REQUEST_STATUS[f.status]?.tone}>{REQUEST_STATUS[f.status]?.label}</Badge>
        <Link href={base({ view: 'requests' })} scroll={false} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><X size={16} /></Link></div>
    </div>
    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
      <div className="min-w-0 space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[14px] sm:grid-cols-3">
          {([['Amount', <Money key="a" value={f.amount} className="font-semibold" />], ['Date', formatShortDate(f.entry_date)], ['Method', methodLabel(f.method)],
            [f.kind === 'received' ? 'Received from' : 'Handed to', f.counterparty ?? '—'], ['Project / site', f.project?.name ?? '—'], ['Reference', f.reference ?? '—'],
            ['Purpose', f.purpose ?? '—'], ['Holds now', <Money key="h" value={avail.get(f.employee_id) ?? 0} />]] as [string, React.ReactNode][]).map(([k, v]) =>
            <div key={k} className="min-w-0"><dt className="text-[12px] text-muted">{k}</dt><dd className="mt-0.5 font-medium [overflow-wrap:anywhere]">{v}</dd></div>)}
        </dl>
        {f.notes && <p className="rounded-xl bg-surface px-3 py-2 text-[13.5px] text-muted [overflow-wrap:anywhere]">“{f.notes}”</p>}
        {f.decision_note && f.status !== 'pending' && <p className="text-[13.5px]"><b className="font-semibold">Decision note:</b> {f.decision_note}{f.decider?.full_name ? ` · ${f.decider.full_name}` : ''}</p>}
        <Link href={`/expenses/petty-cash/${f.employee_id}`} className="inline-flex items-center gap-1 text-[13.5px] font-medium text-primary hover:underline">Open {nm(f.employee_id)}&apos;s wallet<ChevronRight size={14} aria-hidden /></Link>
      </div>
      {f.status === 'pending' && manage && name.get(f.employee_id)?.user_id !== c.userId && <div className="rounded-2xl border border-border bg-surface p-4 shadow-card" data-petty-decide>
        <h3 className="mb-3 text-[15px] font-semibold">Decision</h3>
        <ActionForm action={decidePettyRequest.bind(null, f.id)} submit="Save decision" resetOnSuccess={false}>
          <div className="grid gap-3.5">
            {f.kind === 'received' && <fieldset data-petty-match><legend className="mb-1.5 text-[13px] font-medium">Is this money you already recorded?</legend>
              <div className="grid gap-1.5">
                {matches.map((m, i) => <label key={m.id} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border px-3 py-2.5 text-[14px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                  <input type="radio" name="link" value={m.id} defaultChecked={i === 0} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                  <span><span className="flex items-center gap-1.5 font-medium"><Link2 size={14} aria-hidden />Same as the hand-over of {formatShortDate(m.entry_date)}</span>
                    <span className="block text-[12.5px] text-muted">AED {Number(m.amount).toFixed(2)}{m.reference ? ` · ${m.reference}` : ''}{m.sameRef ? ' · same reference' : ''}. Not credited again.</span></span></label>)}
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border px-3 py-2.5 text-[14px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                  <input type="radio" name="link" value="new" defaultChecked={!matches.length} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                  <span><span className="font-medium">New money, not recorded yet</span><span className="block text-[12.5px] text-muted">Adds AED {Number(f.amount).toFixed(2)} to the employee&apos;s petty cash.</span></span></label>
              </div></fieldset>}
            <fieldset><legend className="mb-1.5 text-[13px] font-medium">What do you decide?</legend>
              <div className="grid gap-1.5">{([['approved', f.kind === 'received' ? 'Confirm: the money was handed over' : 'Confirm: I received the money back'], ['correction_requested', 'Send back for a correction'], ['rejected', 'Not accepted']] as const).map(([k, l], i) =>
                <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-[14px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                  <input type="radio" name="decision" value={k} defaultChecked={i === 0} className="h-4 w-4 accent-[hsl(var(--primary))]" />{l}</label>)}</div></fieldset>
            <Field label="Note to the employee" hint="Required when sending back or not accepting"><Textarea name="note" rows={2} maxLength={2000} /></Field>
            {f.kind === 'return' ? <AccountSelect name="deposit_bank_id" label="Received into" value={null} />
              : <AccountSelect name="paid_from_bank_id" label="Paid from (only for new money)" value={null} />}
          </div>
        </ActionForm></div>}
      {f.status === 'pending' && name.get(f.employee_id)?.user_id === c.userId && <p className="text-[13.5px] text-muted">This is your own report: another approver confirms it.</p>}
    </div>
  </section>

  const header = <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
    <p className="max-w-2xl text-[13.5px] text-muted">Company money employees hold for business purchases. Balances come from confirmed entries only. Separate from salary and salary advances.</p>
    <div className="flex flex-wrap gap-2">
      {c.can('data.export') && <LinkButton href={`/api/petty-cash/export?${new URLSearchParams(Object.fromEntries(Object.entries({ employee: sp.employee, project: sp.project, kind: sp.kind, from: sp.from, to: sp.to }).filter(([, v]) => v)) as Record<string, string>)}`} variant="secondary"><Download size={14} aria-hidden />CSV</LinkButton>}
      {manage && <IssueButton today={c.today} employees={empOpts} projects={projects} />}</div></div>

  const metrics = <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6" data-petty-overview>
    {([['Outstanding petty cash', sum('available'), 'Held by employees now'], ['Distributed', sum('received'), 'Confirmed hand-overs'], ['Expenses settled', sum('settled'), 'Paid from petty cash'],
      ['Reimbursements due', sum('reimbursement_due'), 'Owed to employees'], ['To confirm', (pending ?? []).length, 'Reports waiting'], ['Pending expenses', (pendingClaims ?? []).length, 'Petty cash claims waiting']] as [string, number, string][]).map(([l, v, h], i) =>
      <div key={l} className="bg-surface px-4 py-3.5"><div className="text-[12.5px] text-muted">{l}</div>
        <div className="mt-1 text-[19px] font-semibold tracking-[-0.02em] tabular-nums">{i < 4 ? <Money value={v} /> : v}</div><div className="text-[12px] text-muted">{h}</div></div>)}
  </div>

  const walletTable = (rows: typeof w) => !rows.length ? <EmptyState icon={Wallet} compact title="No petty cash yet" body={manage ? 'Issue petty cash to an employee to start their wallet.' : undefined} />
    : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Employee</Th><Th className="text-right">Available</Th><Th className="text-right">Received</Th><Th className="text-right">Settled</Th><Th className="text-right">Returned</Th><Th className="text-right">Reimbursement due</Th><Th className="text-right">Pending</Th><Th>Last entry</Th></tr></thead>
      <tbody className="divide-y divide-border">{rows.map(r => <tr key={r.employee_id} className="hover:bg-surface-2/50" data-petty-wallet={r.employee_id}>
        <Td className="font-medium"><Link href={`/expenses/petty-cash/${r.employee_id}`} className="hover:text-primary" data-row-primary>{nm(r.employee_id)}</Link><div className="text-xs text-muted">{name.get(r.employee_id)?.employee_no}</div></Td>
        <Td className="text-right font-semibold tabular-nums"><Money value={r.available} /></Td><Td className="text-right tabular-nums"><Money value={r.received} /></Td><Td className="text-right tabular-nums"><Money value={r.settled} /></Td>
        <Td className="text-right tabular-nums"><Money value={r.returned} /></Td><Td className={cn('text-right tabular-nums', r.reimbursement_due > 0 && 'font-medium text-warning')}><Money value={r.reimbursement_due} /></Td>
        <Td className="text-right text-[13px] text-muted">{[r.pending_requests && `${r.pending_requests} to confirm`, r.pending_claims && `${r.pending_claims} expense${r.pending_claims === 1 ? '' : 's'}`, r.awaiting_settlement > 0 && `AED ${r.awaiting_settlement.toFixed(2)} to settle`].filter(Boolean).join(' · ') || '—'}</Td>
        <Td className="text-muted">{r.last_entry ? formatShortDate(r.last_entry) : '—'}</Td></tr>)}</tbody></TableWrap>

  if (view === 'wallets') {
    const term = (sp.q ?? '').trim().toLowerCase()
    const rows = [...w].filter(r => !term || nm(r.employee_id).toLowerCase().includes(term) || (name.get(r.employee_id)?.employee_no ?? '').toLowerCase().includes(term)).sort((a, b) => b.available - a.available)
    return <>{header}{tabs}
      <form className="border-b border-border p-3"><input type="hidden" name="tab" value="petty" /><input type="hidden" name="view" value="wallets" />
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search employees" placeholder="Search employee name or ID…" className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm sm:max-w-md" /></form>
      {walletTable(rows)}</>
  }

  if (view === 'transactions') {
    let q = c.supabase.from('petty_cash_entries').select(`${ENTRY_COLS},employee_id`).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(300)
    if (sp.employee && UUID.test(sp.employee)) q = q.eq('employee_id', sp.employee)
    if (sp.project && UUID.test(sp.project)) q = q.eq('project_id', sp.project)
    if (sp.kind && sp.kind in KIND) q = q.or(`kind.eq.${sp.kind},reverses_kind.eq.${sp.kind}`)
    if (isDay(sp.from)) q = q.gte('entry_date', sp.from!); if (isDay(sp.to)) q = q.lte('entry_date', sp.to!)
    const { data: tx } = await q
    const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
    return <>{header}{tabs}
      <form className="flex flex-wrap items-center gap-2 border-b border-border p-3"><input type="hidden" name="tab" value="petty" /><input type="hidden" name="view" value="transactions" />
        <select name="employee" defaultValue={sp.employee ?? ''} aria-label="Employee" className={cls}><option value="">All employees</option>{empOpts.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        <select name="kind" defaultValue={sp.kind ?? ''} aria-label="Type" className={cls}><option value="">All types</option>{(Object.keys(KIND) as PettyKind[]).filter(k => k !== 'reversal').map(k => <option key={k} value={k}>{KIND[k].label}</option>)}</select>
        <select name="project" defaultValue={sp.project ?? ''} aria-label="Project" className={cls}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input type="date" name="from" defaultValue={sp.from} aria-label="From" className={cls} /><input type="date" name="to" defaultValue={sp.to} aria-label="To" className={cls} />
        <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button>
        {(sp.employee || sp.kind || sp.project || sp.from || sp.to) && <LinkButton href={base({ view: 'transactions' })} variant="ghost">Clear</LinkButton>}</form>
      {!tx?.length ? <EmptyState icon={Wallet} compact title="No transactions" /> : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Employee</Th><Th>Type</Th><Th>Description</Th><Th>Project</Th><Th className="text-right">Amount</Th></tr></thead>
        <tbody className="divide-y divide-border">{(tx as any[]).map(e => <tr key={e.id} className="hover:bg-surface-2/50" data-petty-tx={e.kind}>
          <Td className="whitespace-nowrap tabular-nums">{formatShortDate(e.entry_date)}</Td>
          <Td><Link href={`/expenses/petty-cash/${e.employee_id}`} className="font-medium hover:text-primary">{nm(e.employee_id)}</Link></Td>
          <Td><Badge tone={KIND[e.kind as PettyKind].tone}>{kindLabel(e)}</Badge></Td>
          <Td><div className="max-w-[320px] truncate">{e.description}</div>{e.reference && <div className="text-xs text-muted">{e.reference}</div>}</Td>
          <Td className="text-muted">{e.project?.name ?? '—'}</Td>
          <Td className={cn('text-right font-medium tabular-nums', Number(e.amount) < 0 && 'text-muted')}>{Number(e.amount) > 0 ? '+' : '−'}<Money value={Math.abs(Number(e.amount))} /></Td></tr>)}</tbody></TableWrap>}</>
  }

  if (view === 'requests') {
    return <>{header}{tabs}{detail}
      {!(pending ?? []).length ? <EmptyState icon={Wallet} compact title="Nothing to confirm" body="When employees report petty cash received or a return, it waits here for confirmation." />
        : <ul className="divide-y divide-border" data-petty-queue>{(pending ?? []).map(reqRow)}</ul>}</>
  }

  // overview
  const top = [...w].sort((a, b) => b.available - a.available).slice(0, 8)
  return <>{header}{metrics}{tabs}{detail}
    {(pending ?? []).length > 0 && <section aria-labelledby="pc-confirm" className="border-b border-border">
      <h3 id="pc-confirm" className="flex items-center justify-between px-4 pt-4 text-[14.5px] font-semibold">To confirm <Link href={base({ view: 'requests' })} className="text-[13px] font-medium text-primary hover:underline">All {(pending ?? []).length}</Link></h3>
      <ul className="divide-y divide-border" data-petty-queue>{(pending ?? []).slice(0, 5).map(reqRow)}</ul></section>}
    {awaiting.length > 0 && <section aria-labelledby="pc-settle" className="border-b border-border" data-petty-awaiting>
      <h3 id="pc-settle" className="px-4 pt-4 text-[14.5px] font-semibold">Approved expenses waiting for settlement</h3>
      <p className="px-4 text-[13px] text-muted">Approved, but the employee did not hold enough petty cash. Settle them once more petty cash is issued, or record what the employee paid themselves.</p>
      <ul className="mt-2 divide-y divide-border">{awaiting.map(a => <li key={a.claim_id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{nm(a.employee_id)} · {a.claim?.supplier_name ?? a.claim?.description ?? 'Expense'}</span>
          <span className="block text-xs text-muted">{a.claim?.spent_on ? formatShortDate(a.claim.spent_on) : ''} · {FUNDED_ADMIN[a.funded_by] ?? ''} · total AED {Number(a.total).toFixed(2)}</span></span>
        <span className="text-[13px] text-warning">AED {Number(a.unsettled).toFixed(2)} to settle</span>
        {manage && <SettleButton claimId={a.claim_id} unsettled={Number(a.unsettled)} available={avail.get(a.employee_id) ?? 0} label={a.claim?.supplier_name ?? a.claim?.description ?? 'Expense'} />}</li>)}</ul></section>}
    <section aria-labelledby="pc-wallets"><h3 id="pc-wallets" className="flex items-center justify-between px-4 pb-1 pt-4 text-[14.5px] font-semibold">Employee wallets {w.length > top.length && <Link href={base({ view: 'wallets' })} className="text-[13px] font-medium text-primary hover:underline">All {w.length}</Link>}</h3>
      {walletTable(top)}</section>
    {!manage && <div className="p-4"><Alert>You can see petty cash; issuing and confirming it needs approval rights.</Alert></div>}
  </>
}
