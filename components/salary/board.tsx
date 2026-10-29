'use client'
import Link from 'next/link'
import { useDeferredValue, useMemo, useState } from 'react'
import { Badge, Button, Input, Money, SEG, Select, segItem, Td, Th } from '@/components/ui/primitives'
import { TableWrap } from '@/components/ui/table-wrap'
import { EmptyState } from '@/components/ui/primitives'
import { Search, Users, Wallet } from '@/components/icons'
import { STATUS, type SalaryStatus } from '@/lib/salary-math'
import { PayModal, type PayTarget } from './quick-pay'
import { ShareSheet } from '@/components/whatsapp/share-sheet'

export type BoardRow = PayTarget & { status: string; paidThisMonth: number; payStatus: SalaryStatus; currentId: string | null }
const FILTERS: [string, string][] = [['all', 'All'], ['unpaid', 'Unpaid'], ['partial', 'Partially paid'], ['paid', 'Paid']]

/** The employee salary table: search, status filter, sort, Quick Pay. Phones get one card per person. */
export function SalaryBoard({ rows, today, monthLabel }: { rows: BoardRow[]; today: string; monthLabel: string }) {
  const [q, setQ] = useState(''), [f, setF] = useState('all'), [sort, setSort] = useState('owed')
  // the sheet follows the row: after a payment the page refreshes and "Record another" starts from the new balance
  const [paying, setPaying] = useState<BoardRow | null>(null)
  const payRow = paying ? rows.find(r => r.id === paying.id) ?? paying : null
  const dq = useDeferredValue(q.trim().toLowerCase())
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, k === 'all' ? rows.length : rows.filter(r => r.payStatus === k).length])), [rows])
  const list = useMemo(() => rows
    .filter(r => (f === 'all' || r.payStatus === f) && (!dq || r.name.toLowerCase().includes(dq) || r.no.toLowerCase().includes(dq)))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'paid' ? b.paidThisMonth - a.paidThisMonth || a.name.localeCompare(b.name) : b.outstanding - a.outstanding || a.name.localeCompare(b.name)), [rows, f, dq, sort])
  // the chosen month's payslip, once that month is posted (sharing never posts or pays anything)
  const share = (r: BoardRow) => r.currentId ? <ShareSheet kind="payslip" recordId={r.currentId} variant="ghost" iconOnly label={`Share ${r.name}'s ${monthLabel} payslip via WhatsApp`} /> : null
  const pay = (r: BoardRow) => <Button size="sm" variant={r.outstanding > 0 ? 'primary' : 'secondary'} data-row-stop onClick={() => setPaying(r)} data-quick-pay={r.id}>
    <Wallet size={14} aria-hidden />Pay<span className="sr-only"> {r.name}</span></Button>
  return <>
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
      <label className="relative min-w-0 flex-1 basis-56"><span className="sr-only">Search employees</span>
        <Search size={16} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or employee ID" className="ps-9" data-salary-search /></label>
      <div className={`${SEG} max-w-full overflow-x-auto`} role="group" aria-label="Payment status">
        {FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)} className={segItem(f === k)} data-filter={k}>{l}<span className="text-xs tabular-nums opacity-60">{counts[k]}</span></button>)}
      </div>
      <label className="flex items-center gap-2 text-[13px] text-muted"><span className="hidden sm:inline">Sort</span>
        <Select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort" className="w-auto"><option value="owed">Highest owed</option><option value="name">Name</option><option value="paid">Paid this month</option></Select></label>
    </div>
    {!list.length ? <EmptyState compact icon={Users} title={rows.length ? 'No one matches' : 'No employees with a salary yet'} body={rows.length ? 'Try another name or status.' : 'Set a monthly salary on an employee to see them here.'} />
      : <>
        {/* phones: one card per person */}
        <ul className="divide-y divide-border sm:hidden" data-salary-cards>{list.map(r => <li key={r.id} data-row-link className="px-4 py-3.5 active:bg-fg/[.045]">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1"><Link href={`/salary/${r.id}`} data-row-primary className="line-clamp-2 text-[15px] font-semibold leading-snug">{r.name}</Link>
              <div className="mt-0.5 text-[12.5px] text-muted">{r.no}{r.monthly !== null && <> · <Money value={r.monthly} /> a month</>}</div></div>
            <Badge tone={STATUS[r.payStatus].tone}>{STATUS[r.payStatus].label}</Badge></div>
          <div className="mt-2.5 flex items-end justify-between gap-3">
            <div><div className="text-[12px] text-muted">Total owed</div><div className="text-[19px] font-semibold tracking-[-0.02em]"><Money value={r.outstanding} /></div>
              <div className="mt-0.5 text-[12px] text-muted">Earlier <Money value={r.previous} /> · {monthLabel} {r.current === null ? 'not posted' : <Money value={r.currentDue} />}</div></div>
            <div className="flex items-center gap-1">{share(r)}{pay(r)}</div></div></li>)}</ul>
        <div className="hidden sm:block"><TableWrap cards={false}><thead className="border-b border-border"><tr>
          <Th>Employee</Th><Th className="text-end">Monthly salary</Th><Th className="text-end">Earlier months</Th><Th className="text-end">{monthLabel}</Th>
          <Th className="text-end">Total owed</Th><Th className="text-end">Paid this month</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="divide-y divide-border" data-salary-rows>{list.map(r => <tr key={r.id} className="rtable-row cursor-pointer transition-colors hover:bg-surface-2/60" data-row-link>
            <Td><Link href={`/salary/${r.id}`} data-row-primary className="font-medium hover:text-primary">{r.name}</Link><div className="text-xs text-muted">{r.no}</div></Td>
            <Td className="text-end">{r.monthly === null ? <span className="text-muted">Not set</span> : <Money value={r.monthly} />}</Td>
            <Td className="text-end"><Money value={r.previous} className={r.previous > 0 ? '' : 'text-muted'} /></Td>
            <Td className="text-end">{r.current === null ? <span className="text-xs text-muted">Not posted</span> : <><Money value={r.current} />{r.currentDue < r.current && <div className="text-xs text-muted"><Money value={r.currentDue} /> left</div>}</>}</Td>
            <Td className="text-end font-semibold"><Money value={r.outstanding} className={r.outstanding < 0 ? 'text-success' : ''} />{r.outstanding < 0 && <div className="text-xs font-normal text-success">credit</div>}</Td>
            <Td className="text-end"><Money value={r.paidThisMonth} className={r.paidThisMonth > 0 ? '' : 'text-muted'} /></Td>
            <Td><Badge tone={STATUS[r.payStatus].tone}>{STATUS[r.payStatus].label}</Badge></Td>
            <Td className="text-end"><div className="flex justify-end gap-1">{pay(r)}{share(r)}<Link href={`/salary/${r.id}#statement`} data-row-stop className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium text-muted hover:bg-fg/[.05] hover:text-fg">Statement<span className="sr-only"> for {r.name}</span></Link></div></Td>
          </tr>)}</tbody></TableWrap></div>
      </>}
    {payRow && <PayModal emp={payRow} today={today} onClose={() => setPaying(null)} />}
  </>
}
