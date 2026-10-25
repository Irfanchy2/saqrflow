import { redirect } from 'next/navigation'
import { getMe, myProjects } from '@/lib/me'
import { flat } from '@/lib/queries'
import { EmptyState, Money } from '@/components/ui/primitives'
import { FilterTabs } from '@/components/ui/mobile'
import { Receipt } from '@/components/icons'
import { NewClaim } from '@/components/portal/new-claim'
import { ClaimList, CLAIM_COLS, type ClaimRow } from '@/components/portal/claim-list'
import { PortalCard } from '@/components/portal/stat'
import { claimSuppliers } from '@/lib/expenses/claim-suppliers'
import { companyCards } from '@/lib/cards'

export const metadata = { title: 'My expenses' }
const FILTERS = [['all', 'All'], ['pending', 'Pending'], ['correction_requested', 'Needs correction'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']] as const

/** The employee's own expense claims, newest first, filtered by status. */
export default async function MyExpenses({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await flat(searchParams)
  if (sp.open && /^[0-9a-f-]{36}$/i.test(sp.open)) redirect(`/me/expenses/${sp.open}`)     // links in notifications
  const { c, emp } = await getMe()
  if (!emp) return null
  const status = FILTERS.some(([k]) => k === sp.status) ? sp.status! : 'all'
  const [cards, projects, sups, { data: counts }, { data: rows }] = await Promise.all([
    companyCards(c),
    myProjects(c),
    claimSuppliers(c, emp.id),
    c.supabase.from('expense_claims').select('status').eq('employee_id', emp.id).limit(5000),
    (status === 'all' ? c.supabase.from('expense_claims').select(CLAIM_COLS).eq('employee_id', emp.id)
      : c.supabase.from('expense_claims').select(CLAIM_COLS).eq('employee_id', emp.id).eq('status', status)).order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(200),
  ])
  const n = (k: string) => (k === 'all' ? counts ?? [] : (counts ?? []).filter(r => r.status === k)).length
  const list = (rows ?? []) as ClaimRow[]
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
      <div><h1 className="text-[26px] font-semibold tracking-[-0.03em] sm:text-[30px]">My expenses</h1>
        <p className="mt-0.5 text-[13px] text-muted">Only you and the people who approve expenses can see these.</p></div>
      <div className="hidden sm:block"><NewClaim today={c.today} size="sm" suppliers={sups} cards={cards} projects={projects} /></div>
    </div>
    <div className="sm:hidden"><NewClaim today={c.today} suppliers={sups} cards={cards} projects={projects} /></div>
    <PortalCard title={status === 'all' ? 'All expenses' : FILTERS.find(([k]) => k === status)![1]} sub={list.length ? <>Total <Money value={list.reduce((s, r) => s + Number(r.amount) + Number(r.vat_amount), 0)} /></> : undefined}>
      <FilterTabs label="Filter by status" className="px-3 sm:px-4" tabs={FILTERS.filter(([k]) => k === 'all' || k === status || n(k) > 0).map(([k, l]) => ({ href: k === 'all' ? '/me/expenses' : `/me/expenses?status=${k}`, label: l, active: k === status, count: n(k) }))} />
      {list.length ? <ClaimList rows={list} /> : <EmptyState compact icon={Receipt} title={status === 'all' ? 'No expenses yet' : 'Nothing here'} body={status === 'all' ? 'Scan a receipt or enter an expense: it goes to your manager for approval.' : 'No expenses with this status.'} />}
    </PortalCard>
  </div>
}
