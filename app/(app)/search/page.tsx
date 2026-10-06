import Link from 'next/link'
import { Search, Sparkles } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat, sanitizeQ } from '@/lib/queries'
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives'
import { DOC_META, STATUS_TONE, statusLabel, type SalesType } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'

export const metadata = { title: 'Search' }
type Hit = { href: string; title: string; sub?: string | null; badge?: React.ReactNode }

/** One box for everything: AS0025180, Mohammed, ABC Contracting, Villa Fujairah, INV-102 … Every query runs as the user (RLS). */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); const sp = await flat(searchParams); const q = sanitizeQ(sp.q)
  const run = q.length >= 2, fin = c.can('finance.view'), like = `%${q}%`
  const none = Promise.resolve({ data: [] as any[] })
  const [cust, sup, proj, sales, emps, docs, assets, chq] = run ? await Promise.all([
    c.can('documents.view') ? c.supabase.from('customers').select('id,name,contact_person,phone,trn').or(`name.ilike.${like},contact_person.ilike.${like},phone.ilike.${like},email.ilike.${like},trn.ilike.${like}`).limit(8) : none,
    c.can('documents.view') ? c.supabase.from('suppliers').select('id,name,contact_person,phone').or(`name.ilike.${like},contact_person.ilike.${like},phone.ilike.${like},trn.ilike.${like}`).limit(6) : none,
    c.can('documents.view') ? c.supabase.from('projects').select('id,name,code,location,status').or(`name.ilike.${like},code.ilike.${like},location.ilike.${like},description.ilike.${like}`).limit(8) : none,
    fin ? c.supabase.from('invoices').select('id,doc_type,number,status,customer_name,subject,site,total,issue_date').or(`number.ilike.${like},customer_name.ilike.${like},subject.ilike.${like},site.ilike.${like},lpo_ref.ilike.${like},reference.ilike.${like}`).order('issue_date', { ascending: false }).limit(12) : none,
    c.supabase.from('employees').select('id,full_name,employee_no,designation').or(`full_name.ilike.${like},employee_no.ilike.${like},designation.ilike.${like},phone.ilike.${like}`).limit(8),
    c.supabase.from('documents').select('id,name,reference_no,expiry_date,owner_type').is('deleted_at', null).or(`name.ilike.${like},reference_no.ilike.${like},issuing_authority.ilike.${like}`).limit(8),
    c.can('documents.view') ? c.supabase.from('assets').select('id,name,kind,plate_or_serial,asset_code,make,model').or(`name.ilike.${like},plate_or_serial.ilike.${like},asset_code.ilike.${like},serial_no.ilike.${like},make.ilike.${like},model.ilike.${like}`).limit(8) : none,
    fin ? c.supabase.from('cheques').select('id,cheque_no,party_name,amount,cheque_date,status').or(`cheque_no.ilike.${like},party_name.ilike.${like}`).limit(8) : none,
  ]) : []
  const groups: [string, Hit[]][] = run ? [
    ['Quotations, invoices & delivery notes', (sales!.data ?? []).map((s: any) => ({ href: `/invoices/${s.id}`, title: `${s.number} · ${s.customer_name ?? '—'}`, sub: [DOC_META[s.doc_type as SalesType]?.label, s.subject ?? s.site, DOC_META[s.doc_type as SalesType]?.priced ? `AED ${fmtMoney(s.total)}` : null].filter(Boolean).join(' · '), badge: <Badge tone={STATUS_TONE[s.status]}>{statusLabel(s.doc_type, s.status)}</Badge> }))],
    ['Customers', (cust!.data ?? []).map((x: any) => ({ href: `/parties/${x.id}`, title: x.name, sub: [x.contact_person, x.phone, x.trn && `TRN ${x.trn}`].filter(Boolean).join(' · ') }))],
    ['Projects', (proj!.data ?? []).map((x: any) => ({ href: `/projects/${x.id}`, title: x.name, sub: [x.code, x.location].filter(Boolean).join(' · ') }))],
    ['Employees', (emps!.data ?? []).map((x: any) => ({ href: `/employees/${x.id}`, title: x.full_name, sub: [x.employee_no, x.designation].filter(Boolean).join(' · ') }))],
    ['Documents', (docs!.data ?? []).map((x: any) => ({ href: `/documents/${x.id}`, title: x.name, sub: [x.reference_no, x.expiry_date && `expires ${x.expiry_date}`].filter(Boolean).join(' · ') }))],
    ['Vehicles & assets', (assets!.data ?? []).map((x: any) => ({ href: `/assets/${x.id}`, title: x.name, sub: [x.plate_or_serial ?? x.asset_code, x.make, x.model].filter(Boolean).join(' · ') }))],
    ['Cheques', (chq!.data ?? []).map((x: any) => ({ href: `/cheques?open=${x.id}`, title: `#${x.cheque_no} · ${x.party_name}`, sub: `AED ${fmtMoney(x.amount)} · ${x.cheque_date} · ${x.status}` }))],
    ['Suppliers', (sup!.data ?? []).map((x: any) => ({ href: `/parties?tab=suppliers&q=${encodeURIComponent(x.name)}`, title: x.name, sub: [x.contact_person, x.phone].filter(Boolean).join(' · ') }))],
  ] : []
  const total = groups.reduce((s, [, h]) => s + h.length, 0)
  return <><PageHeader title="Search" sub={run ? `${total} result${total === 1 ? '' : 's'} for “${q}”` : 'Search customers, quotations (e.g. AS0025180), invoices, projects, people, documents, vehicles and cheques.'} />
    <form className="mb-4 flex max-w-xl gap-2"><input name="q" type="search" defaultValue={sp.q} autoFocus aria-label="Search everything" placeholder="e.g. AS0025180, Mohammed, ABC Contracting, Villa Fujairah, INV-102" className="h-10 flex-1 rounded-md border border-border bg-surface px-3 text-sm" />
      <button className="h-10 cursor-pointer rounded-md bg-primary px-4 text-sm font-medium text-primary-fg">Search</button></form>
    {run && <Link href={`/assistant?q=${encodeURIComponent(sp.q ?? '')}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><Sparkles size={14} />Ask AI Search: “{sp.q}”</Link>}
    {run && total === 0 ? <Card><EmptyState icon={Search} title="No results" body="Try a different spelling, or part of a name, number or reference." /></Card> :
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3 [&>*]:min-w-0">{groups.filter(([, h]) => h.length).map(([title, hits]) => <Card key={title}><CardHeader title={title} />
        <ul className="divide-y divide-border text-sm">{hits.map(h => <li key={h.href}><Link href={h.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{h.title}</span>{h.sub && <span className="block truncate text-xs text-muted">{h.sub}</span>}</span>{h.badge}</Link></li>)}</ul></Card>)}</div>}</>
}
