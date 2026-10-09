import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Download, Paperclip, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, LinkButton, PageHeader, Pagination, Metrics, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { ExpenseFields } from '@/components/expenses/expense-fields'
import { deleteExpense, saveExpense } from '@/app/actions/projects'
import { EXPENSE_CATS, PAYMENT_METHODS } from '@/lib/projects'
import { fmtMoney } from '@/lib/sales/money'
import { formatAed } from '@/lib/time'
import { SavedViews } from '@/components/saved-views'

export const metadata = { title: 'Expenses' }
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const sp = await flat(searchParams), page = pageOf(sp.page), term = sanitizeQ(sp.q), edit = c.can('records.edit')
  const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const month = c.today.slice(0, 7) + '-01', from = d(sp.from), to = d(sp.to)
  let q = c.supabase.from('project_expenses').select('*, project:projects(id,name), employee:employees(full_name)', { count: 'exact' })
  if (term) q = q.or(`description.ilike.%${term}%,supplier_name.ilike.%${term}%,reference.ilike.%${term}%`)
  if (sp.category && sp.category in EXPENSE_CATS) q = q.eq('category', sp.category)
  if (sp.project === 'none') q = q.is('project_id', null); else if (sp.project && /^[0-9a-f-]{36}$/.test(sp.project)) q = q.eq('project_id', sp.project)
  if (from) q = q.gte('spent_on', from); if (to) q = q.lte('spent_on', to)
  const [{ data, count }, { data: monthRows }, { data: projects }, { data: employees }, { data: suppliers }, { data: assetRows }] = await Promise.all([
    q.order('spent_on', { ascending: false }).order('created_at', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    c.supabase.from('project_expenses').select('amount,vat_amount,category').gte('spent_on', month).lte('spent_on', c.today).limit(10000),
    c.supabase.from('projects').select('id,name').order('name').limit(500),
    edit ? c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000) : Promise.resolve({ data: [] as any[] }),
    edit ? c.supabase.from('suppliers').select('name').order('name').limit(1000) : Promise.resolve({ data: [] as any[] }),
    edit ? c.supabase.from('assets').select('id,name,plate_or_serial').is('archived_at', null).order('name').limit(1000) : Promise.resolve({ data: [] as any[] }),
  ])
  const mTotal = (monthRows ?? []).reduce((s, r) => s + Number(r.amount), 0), mVat = (monthRows ?? []).reduce((s, r) => s + Number(r.vat_amount), 0)
  const byCat: Record<string, number> = {}; for (const r of monthRows ?? []) byCat[r.category] = (byCat[r.category] ?? 0) + Number(r.amount)
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 2)
  const emps = (employees ?? []).map((e: any) => ({ id: e.id, name: e.full_name })), sups = (suppliers ?? []).map((s: any) => s.name), projs = (projects ?? []) as { id: string; name: string }[]
  const assetOpts = (assetRows ?? []).map((a: any) => ({ id: a.id, name: a.plate_or_serial ? `${a.name} (${a.plate_or_serial})` : a.name }))
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  return <>
    <PageHeader title="Expenses" sub="Materials, labour, fuel, transport and other costs. Per project or general. Receipts are stored privately; OCR only suggests the details."
      actions={<><SavedViews page="/expenses" />{c.can('data.export') && <LinkButton href="/api/export/expenses?format=xlsx" variant="secondary"><Download size={14} />Excel</LinkButton>}
        {edit && <DialogButton wide openParam="expense" label="Add expense" title="Add expense" icon={<Plus size={15} />}><ActionForm draftKey="expense:new" action={saveExpense.bind(null, null, null)} submit="Save expense" idempotent><ExpenseFields today={c.today} projects={projs} assets={assetOpts} employees={emps} suppliers={sups} /></ActionForm></DialogButton>}</>} />
    <Metrics className="mb-5" cols={4}>
      <StatCard label="This month (excl. VAT)" value={formatAed(mTotal)} icon={Wallet} tone="blue" />
      <StatCard label="Input VAT this month" value={formatAed(mVat)} hint="Recoverable VAT on receipts" />
      {top.map(([k, v]) => <StatCard key={k} label={`${EXPENSE_CATS[k]} this month`} value={formatAed(v)} />)}
    </Metrics>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3">
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search expenses" placeholder="Search description, supplier, reference…" className={`${cls} min-w-52 flex-1`} />
        <select name="category" defaultValue={sp.category ?? ''} aria-label="Category" className={cls}><option value="">All categories</option>{Object.entries(EXPENSE_CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="project" defaultValue={sp.project ?? ''} aria-label="Project" className={cls}><option value="">All projects</option><option value="none">General (no project)</option>{projs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input type="date" name="from" defaultValue={from} aria-label="From" className={cls} /><input type="date" name="to" defaultValue={to} aria-label="To" className={cls} />
        <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button>
        {(term || sp.category || sp.project || from || to) && <LinkButton href="/expenses" variant="ghost">Clear</LinkButton>}</form>
      {!data?.length ? <EmptyState icon={Wallet} title={term || sp.category || sp.project || from ? 'No matching expenses' : 'No expenses yet'} body="Record costs here (or on a project page) to see real project profit."
          action={edit && !term ? <DialogButton wide label="Add first expense" title="Add expense" icon={<Plus size={15} />}><ActionForm action={saveExpense.bind(null, null, null)} submit="Save expense" idempotent><ExpenseFields today={c.today} projects={projs} assets={assetOpts} employees={emps} suppliers={sups} /></ActionForm></DialogButton> : undefined} />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Description</Th><Th>Category</Th><Th>Project</Th><Th>Payment</Th><Th className="text-right">Amount</Th><Th className="text-right">VAT</Th>{edit && <Th />}</tr></thead>
          <tbody className="divide-y divide-border">{data.map((e: any) => <tr key={e.id} className="hover:bg-surface-2/50">
            <Td className="whitespace-nowrap tabular-nums">{e.spent_on}</Td>
            <Td><div className="max-w-[320px] truncate font-medium">{e.description}{e.approval_status && e.approval_status !== 'approved' && <Badge tone={e.approval_status === 'pending' ? 'amber' : 'red'} className="ms-2">{e.approval_status === 'pending' ? 'Awaiting approval' : e.approval_status === 'rejected' ? 'Rejected' : 'Changes requested'}</Badge>}</div><div className="text-xs text-muted">{[e.supplier_name, e.reference, e.employee?.full_name].filter(Boolean).join(' · ') || '—'}
              {e.receipt_document_id && <Link href={`/documents/${e.receipt_document_id}`} className="ms-2 inline-flex items-center gap-0.5 text-primary hover:underline"><Paperclip size={11} />receipt</Link>}</div></Td>
            <Td>{EXPENSE_CATS[e.category] ?? e.category}</Td><Td className="max-w-[180px] truncate">{e.project ? <Link href={`/projects/${e.project.id}`} className="text-primary hover:underline">{e.project.name}</Link> : <span className="text-muted">General</span>}</Td>
            <Td className="text-muted">{e.payment_method ? PAYMENT_METHODS[e.payment_method] : '—'}</Td>
            <Td className="text-right font-medium tabular-nums">{fmtMoney(e.amount)}</Td><Td className="text-right tabular-nums text-muted">{Number(e.vat_amount) ? fmtMoney(e.vat_amount) : '—'}</Td>
            {edit && <Td className="text-right"><div className="flex justify-end gap-1">
              <DialogButton wide size="sm" variant="ghost" label={<><Pencil size={13} /><span className="sr-only">Edit</span></>} title="Edit expense"><ActionForm action={saveExpense.bind(null, e.id, null)} resetOnSuccess={false}><ExpenseFields e={e} today={c.today} projects={projs} assets={assetOpts} employees={emps} suppliers={sups} /></ActionForm></DialogButton>
              {c.can('records.delete') && <ActionButton variant="ghost" action={deleteExpense.bind(null, e.id)} confirm="Delete this expense? (The receipt stays in the Vault.)"><Trash2 size={13} /><span className="sr-only">Delete</span></ActionButton>}</div></Td>}</tr>)}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/expenses" />
    </Card>
  </>
}
