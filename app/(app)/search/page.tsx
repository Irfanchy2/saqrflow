import Link from 'next/link'
import { Search } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat, sanitizeQ } from '@/lib/queries'
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives'
import { Sparkles } from 'lucide-react'

export const metadata = { title: 'Search' }
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); const sp = await flat(searchParams); const q = sanitizeQ(sp.q)
  const run = q.length >= 2
  // every query goes through the user's own session → results are automatically permission-filtered by RLS
  const [docs, emps, chq] = run ? await Promise.all([
    c.supabase.from('documents').select('id,name,reference_no,expiry_date,owner_type').is('deleted_at', null).or(`name.ilike.%${q}%,reference_no.ilike.%${q}%,issuing_authority.ilike.%${q}%`).limit(8),
    c.supabase.from('employees').select('id,full_name,employee_no,designation').or(`full_name.ilike.%${q}%,employee_no.ilike.%${q}%,designation.ilike.%${q}%`).limit(8),
    c.supabase.from('cheques').select('id,cheque_no,party_name,amount,cheque_date').or(`cheque_no.ilike.%${q}%,party_name.ilike.%${q}%`).limit(8),
  ]) : [null, null, null]
  const total = (docs?.data?.length ?? 0) + (emps?.data?.length ?? 0) + (chq?.data?.length ?? 0)
  const Section = ({ title, children, n }: { title: string; children: React.ReactNode; n: number }) => n ? <Card><CardHeader title={title} /><ul className="divide-y divide-border text-sm">{children}</ul></Card> : null
  const row = 'flex items-center justify-between px-4 py-2.5 hover:bg-surface-2/60'
  return <><PageHeader title="Search" sub={run ? `Results for “${q}”` : 'Type at least 2 characters in the search bar.'} />
    {run && <Link href={`/assistant?q=${encodeURIComponent(sp.q ?? '')}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><Sparkles size={14} />Ask AI Search: “{sp.q}”</Link>}
    {run && total === 0 ? <Card><EmptyState icon={Search} title="No results" body="Try a different spelling, or part of a name or reference." /></Card> :
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Documents" n={docs?.data?.length ?? 0}>{docs?.data?.map(d => <li key={d.id}><Link href={`/documents/${d.id}`} className={row}><span>{d.name}</span><span className="text-xs text-muted">{d.expiry_date ?? d.owner_type}</span></Link></li>)}</Section>
        <Section title="Employees" n={emps?.data?.length ?? 0}>{emps?.data?.map(e => <li key={e.id}><Link href={`/employees/${e.id}`} className={row}><span>{e.full_name}</span><span className="text-xs text-muted">{e.employee_no}</span></Link></li>)}</Section>
        <Section title="Cheques" n={chq?.data?.length ?? 0}>{chq?.data?.map(x => <li key={x.id}><Link href={`/cheques?open=${x.id}`} className={row}><span>{x.party_name} · #{x.cheque_no}</span><span className="text-xs text-muted">{x.cheque_date}</span></Link></li>)}</Section></div>}</>
}
