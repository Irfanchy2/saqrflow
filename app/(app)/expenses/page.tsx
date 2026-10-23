import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Download, Fuel, HardHat, Home, Package, Paperclip, Pencil, Plus, ScanText, ShieldCheck, Trash2, Truck, Users, Utensils, Wallet, Wrench } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Pagination, Metrics, Money, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { TabStrip } from '@/components/ui/tab-strip'
import { ExpenseFields } from '@/components/expenses/expense-fields'
import { ScanReceiptButton } from '@/components/expenses/scan-button'
import { TallyPanel } from '@/components/expenses/tally-panel'
import { deleteExpense, saveExpense } from '@/app/actions/projects'
import { saveSupplierLedger } from '@/app/actions/expenses'
import { EXPENSE_CATS, PAYMENT_METHODS } from '@/lib/projects'
import { loadExportRows, loadTallySettings, readFilters } from '@/lib/expenses/export-data'
import { fmtMoney } from '@/lib/sales/money'
import { formatAed, formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SavedViews } from '@/components/saved-views'
import { Fab, FilterBar, FilterTabs, MList, MRow, Tile, TINTS, type TintKey } from '@/components/ui/mobile'

export const metadata = { title: 'Expenses' }
const CAT_ICON: Record<string, [typeof Wallet, TintKey]> = { material: [Package, 'orange'], labour: [HardHat, 'blue'], subcontract: [Users, 'violet'], transport: [Truck, 'rose'], fuel: [Fuel, 'rose'], equipment: [Wrench, 'amber'], accommodation: [Home, 'teal'], food: [Utensils, 'green'], maintenance: [Wrench, 'sky'], other: [Wallet, 'slate'] }
const UUID = /^[0-9a-f-]{36}$/

/** Expenses and supplier purchases: the list (with receipts, payment and export status), suppliers, and the Tally export. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const sp = await flat(searchParams), edit = c.can('records.edit'), exp = c.can('data.export')
  const tab = sp.tab === 'suppliers' ? 'suppliers' : sp.tab === 'tally' && exp ? 'tally' : 'list'
  const [{ data: projects }, { data: employees }, { data: suppliers }, { data: assetRows }] = await Promise.all([
    c.supabase.from('projects').select('id,name').order('name').limit(500),
    edit ? c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('suppliers').select('id,name,trn,tally_ledger,phone').is('deleted_at', null).order('name').limit(2000),
    edit ? c.supabase.from('assets').select('id,name,plate_or_serial').is('archived_at', null).order('name').limit(1000) : Promise.resolve({ data: [] as any[] }),
  ])
  const emps = (employees ?? []).map((e: any) => ({ id: e.id, name: e.full_name })), projs = (projects ?? []) as { id: string; name: string }[]
  const sups = (suppliers ?? []).map((s: any) => ({ id: s.id as string, name: s.name as string, trn: s.trn as string | null }))
  const assetOpts = (assetRows ?? []).map((a: any) => ({ id: a.id, name: a.plate_or_serial ? `${a.name} (${a.plate_or_serial})` : a.name }))
  const form = (e?: any) => <ExpenseFields e={e} today={c.today} projects={projs} assets={assetOpts} employees={emps} suppliers={sups} />

  const tabs = <TabStrip label="Expenses sections" className="px-3">{[['list', 'Expenses'], ['suppliers', 'Suppliers'], ...(exp ? [['tally', 'Tally export']] : [])].map(([k, l]) =>
    <Link key={k} href={k === 'list' ? '/expenses' : `/expenses?tab=${k}`} aria-current={tab === k ? 'page' : undefined}
      className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors', tab === k ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-fg')}>{l}</Link>)}</TabStrip>

  const header = <PageHeader title="Expenses" sub="Supplier purchases and running costs. Scan a receipt or enter it by hand; scanned details are only suggestions until you check them. Export verified expenses to Tally."
    actions={<><SavedViews page="/expenses" />{exp && <LinkButton href="/api/export/expenses?format=xlsx" variant="secondary"><Download size={14} />Excel</LinkButton>}
      {edit && <ScanReceiptButton today={c.today} projects={projs} assets={assetOpts} employees={emps} suppliers={sups} />}
      {edit && <DialogButton wide openParam="expense" variant="secondary" label="Add expense" title="Add expense" icon={<Plus size={15} />}><ActionForm draftKey="expense:new" action={saveExpense.bind(null, null, null)} submit="Save expense" idempotent>{form()}</ActionForm></DialogButton>}</>} />

  if (tab === 'tally') {
    const f = readFilters(sp)
    const [rows, settings, { data: batches }, { data: banks }] = await Promise.all([
      loadExportRows(c, f), loadTallySettings(c),
      c.supabase.from('expense_exports').select('id,ref,created_at,expense_count,total,vat_total,tally_version,released_at,release_reason,creator:profiles!expense_exports_created_by_fkey(full_name)').order('created_at', { ascending: false }).limit(50),
      c.supabase.from('banks').select('id,name,account_display_name').eq('is_account', true).order('name'),
    ])
    return <>{header}<Card className="mb-5">{tabs}</Card>
      <TallyPanel rows={rows} settings={settings} batches={(batches ?? []) as any} banks={(banks ?? []).map(b => ({ id: b.id, label: [b.name, b.account_display_name].filter(Boolean).join(' ') }))} suppliers={sups} filters={f} canEdit={exp && edit} /></>
  }

  if (tab === 'suppliers') {
    const term = sanitizeQ(sp.q)
    const { data: spend } = await c.supabase.from('project_expenses').select('supplier_id,amount,vat_amount,payment_status,spent_on').not('supplier_id', 'is', null).limit(20000)
    const agg = new Map<string, { n: number; total: number; unpaid: number; last: string }>()
    for (const r of spend ?? []) { const a = agg.get(r.supplier_id!) ?? { n: 0, total: 0, unpaid: 0, last: '' }; const t = Number(r.amount) + Number(r.vat_amount); a.n++; a.total += t; if (r.payment_status === 'unpaid') a.unpaid += t; if (r.spent_on > a.last) a.last = r.spent_on; agg.set(r.supplier_id!, a) }
    const list = (suppliers ?? []).filter((s: any) => !term || [s.name, s.trn, s.phone, s.tally_ledger].some(v => v && String(v).toLowerCase().includes(term.toLowerCase())))
      .sort((a: any, b: any) => (agg.get(b.id)?.total ?? 0) - (agg.get(a.id)?.total ?? 0))
    return <>{header}<Card>{tabs}
      <form className="flex flex-wrap items-center gap-2 border-b border-border p-3"><input type="hidden" name="tab" value="suppliers" />
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search suppliers" placeholder="Search name, TRN, phone, Tally ledger…" className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm sm:max-w-md" />
        <LinkButton href="/parties?tab=suppliers" variant="ghost">Contacts and addresses</LinkButton></form>
      {!list.length ? <EmptyState icon={Users} title={term ? 'No matching suppliers' : 'No suppliers yet'} body="Suppliers are saved automatically from the expenses you enter or scan." />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Supplier</Th><Th>TRN</Th><Th>Tally ledger</Th><Th className="text-right">Bills</Th><Th className="text-right">Total</Th><Th className="text-right">Unpaid</Th><Th>Last bill</Th><Th /></tr></thead>
          <tbody className="divide-y divide-border">{list.map((s: any) => { const a = agg.get(s.id)
            return <tr key={s.id} className="hover:bg-surface-2/50" data-supplier={s.name}>
              <Td className="font-medium"><Link href={`/expenses?supplier=${s.id}`} className="hover:text-primary" data-row-primary>{s.name}</Link></Td>
              <Td className="font-mono text-[12.5px] text-muted">{s.trn ?? '—'}</Td>
              <Td className={s.tally_ledger ? '' : 'text-muted'}>{s.tally_ledger ?? <span title="The supplier's name is used as its Tally ledger">Same as name</span>}</Td>
              <Td className="text-right tabular-nums">{a?.n ?? 0}</Td><Td className="text-right tabular-nums">{a ? fmtMoney(a.total) : '—'}</Td>
              <Td className={cn('text-right tabular-nums', a?.unpaid ? 'font-medium text-warning' : 'text-muted')}>{a?.unpaid ? fmtMoney(a.unpaid) : '—'}</Td>
              <Td className="text-muted">{a?.last ? formatShortDate(a.last) : '—'}</Td>
              <Td className="text-right">{edit && <DialogButton size="sm" variant="ghost" label={<><Pencil size={13} />Edit</>} title={`${s.name}: Tally ledger and TRN`}>
                <ActionForm action={saveSupplierLedger.bind(null, s.id)} resetOnSuccess={false}>
                  <div className="grid gap-4"><Field label="Tally ledger name" hint="Exactly as in Tally (Sundry Creditors). Empty = the supplier's name"><Input name="tally_ledger" defaultValue={s.tally_ledger ?? ''} maxLength={200} /></Field>
                    <Field label="TRN" hint="15 digits"><Input name="trn" defaultValue={s.trn ?? ''} inputMode="numeric" maxLength={20} /></Field></div></ActionForm></DialogButton>}</Td></tr> })}</tbody></TableWrap>}
    </Card></>
  }

  // ── the expense list (searchable history) ──
  const page = pageOf(sp.page), term = sanitizeQ(sp.q)
  const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const month = c.today.slice(0, 7) + '-01', from = d(sp.from), to = d(sp.to)
  let q = c.supabase.from('project_expenses').select('*, project:projects(id,name), employee:employees(full_name), batch:expense_exports!project_expenses_export_batch_fk(ref)', { count: 'exact' })
  if (term) q = q.or(`description.ilike.%${term}%,supplier_name.ilike.%${term}%,reference.ilike.%${term}%,payment_ref.ilike.%${term}%,supplier_trn.ilike.%${term}%`)
  if (sp.category && sp.category in EXPENSE_CATS) q = q.eq('category', sp.category)
  if (sp.project === 'none') q = q.is('project_id', null); else if (sp.project && UUID.test(sp.project)) q = q.eq('project_id', sp.project)
  if (sp.supplier && UUID.test(sp.supplier)) q = q.eq('supplier_id', sp.supplier)
  if (sp.paid === 'paid' || sp.paid === 'unpaid') q = q.eq('payment_status', sp.paid)
  if (sp.export === 'yes') q = q.not('export_batch_id', 'is', null); else if (sp.export === 'no') q = q.is('export_batch_id', null)
  if (sp.check === 'no') q = q.is('verified_at', null)
  if (from) q = q.gte('spent_on', from); if (to) q = q.lte('spent_on', to)
  const [{ data, count }, { data: monthRows }, { data: unpaidRows }] = await Promise.all([
    q.order('spent_on', { ascending: false }).order('created_at', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    c.supabase.from('project_expenses').select('amount,vat_amount,category').gte('spent_on', month).lte('spent_on', c.today).limit(10000),
    c.supabase.from('project_expenses').select('amount,vat_amount').eq('payment_status', 'unpaid').limit(10000),
  ])
  const mTotal = (monthRows ?? []).reduce((s, r) => s + Number(r.amount), 0), mVat = (monthRows ?? []).reduce((s, r) => s + Number(r.vat_amount), 0)
  const owed = (unpaidRows ?? []).reduce((s, r) => s + Number(r.amount) + Number(r.vat_amount), 0)
  const byCat: Record<string, number> = {}; for (const r of monthRows ?? []) byCat[r.category] = (byCat[r.category] ?? 0) + Number(r.amount)
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  const filtered = !!(term || sp.category || sp.project || sp.supplier || sp.paid || sp.export || sp.check || from || to)
  const badges = (e: any) => <>
    {e.payment_status === 'unpaid' && <Badge tone="amber" className="ms-2">Unpaid</Badge>}
    {e.export_batch_id && <Badge tone="green" className="ms-2"><ShieldCheck size={11} aria-hidden />{e.batch?.ref ?? 'Exported'}</Badge>}
    {!e.verified_at && sp.check === 'no' && <Badge tone="neutral" className="ms-2">Not checked</Badge>}
    {e.approval_status && e.approval_status !== 'approved' && <Badge tone={e.approval_status === 'pending' ? 'amber' : 'red'} className="ms-2">{e.approval_status === 'pending' ? 'Awaiting approval' : e.approval_status === 'rejected' ? 'Rejected' : 'Changes requested'}</Badge>}</>
  const editBtn = (e: any, mobile = false) => edit ? <DialogButton wide size="sm" variant="ghost" label={mobile ? <><Pencil size={13} />Edit</> : <><Pencil size={13} /><span className="sr-only">Edit</span></>} title={e.export_batch_id ? `Expense (exported in ${e.batch?.ref ?? 'a Tally export'})` : 'Edit expense'}>
    {e.export_batch_id && <p className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">This expense is in Tally export {e.batch?.ref}. Notes, project and employee can change; amounts, dates, supplier and payment are locked until that export is undone (Tally export tab).</p>}
    <ActionForm action={saveExpense.bind(null, e.id, null)} resetOnSuccess={false}>{form(e)}</ActionForm></DialogButton> : undefined
  return <>
    {header}
    <Metrics className="mb-5" cols={4}>
      <StatCard label="This month (excl. VAT)" value={formatAed(mTotal)} icon={Wallet} tone="blue" />
      <StatCard label="Input VAT this month" value={formatAed(mVat)} hint="Recoverable VAT on receipts" />
      <StatCard label="Unpaid bills" value={formatAed(owed)} href="/expenses?paid=unpaid" hint={(unpaidRows ?? []).length ? `${(unpaidRows ?? []).length} owed to suppliers` : 'Nothing owed'} />
      {top ? <StatCard label={`${EXPENSE_CATS[top[0]]} this month`} value={formatAed(top[1])} /> : <StatCard label="Top category" value="—" />}
    </Metrics>
    <Card>
      {tabs}
      {sp.check === 'no' && <p className="border-b border-border bg-surface-2/60 px-4 py-2.5 text-[13.5px] text-muted">Expenses saved before checking was recorded. Open each one, compare it with its receipt and save: saving marks it as checked, ready for Tally.</p>}
      <FilterTabs label="Category" className="px-2" tabs={[['', 'All'], ['material', 'Materials'], ['labour', 'Labour'], ['transport', 'Transport'], ['fuel', 'Fuel'], ['equipment', 'Equipment'], ['other', 'Other']].map(([k, l]) => ({ href: k ? `/expenses?category=${k}` : '/expenses', label: l, active: (sp.category ?? '') === k }))} />
      <form className="border-b border-border p-3"><FilterBar active={!!(sp.project || sp.supplier || sp.paid || sp.export || from || to)} search={<input name="q" type="search" defaultValue={sp.q} aria-label="Search expenses" placeholder="Search supplier, invoice no., TRN, description…" className={`${cls} h-11 min-w-0 flex-1 sm:h-10`} />}>
        <select name="supplier" defaultValue={sp.supplier ?? ''} aria-label="Supplier" className={cls}><option value="">All suppliers</option>{sups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select name="category" defaultValue={sp.category ?? ''} aria-label="Category" className={cls}><option value="">All categories</option>{Object.entries(EXPENSE_CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="paid" defaultValue={sp.paid ?? ''} aria-label="Paid or unpaid" className={cls}><option value="">Paid and unpaid</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select>
        <select name="export" defaultValue={sp.export ?? ''} aria-label="Tally export" className={cls}><option value="">Exported or not</option><option value="no">Not exported</option><option value="yes">Exported to Tally</option></select>
        <select name="project" defaultValue={sp.project ?? ''} aria-label="Project" className={cls}><option value="">All projects</option><option value="none">General (no project)</option>{projs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input type="date" name="from" defaultValue={from} aria-label="From" className={cls} /><input type="date" name="to" defaultValue={to} aria-label="To" className={cls} />
        <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button>
        {filtered && <LinkButton href="/expenses" variant="ghost">Clear</LinkButton>}</FilterBar></form>
      {!data?.length ? <EmptyState icon={Wallet} title={filtered ? 'No matching expenses' : 'No expenses yet'} body="Scan a receipt with your phone, or add an expense by hand, to see costs per project and export them to Tally."
          action={edit && !filtered ? <DialogButton wide label="Add first expense" title="Add expense" icon={<Plus size={15} />}><ActionForm action={saveExpense.bind(null, null, null)} submit="Save expense" idempotent>{form()}</ActionForm></DialogButton> : undefined} />
        : <><MList>{data.map((e: any) => { const [I, t] = CAT_ICON[e.category] ?? CAT_ICON.other
          return <MRow key={e.id} lead={<Tile icon={I} tint={TINTS[t]} />} title={<>{e.supplier_name ?? e.description}{e.payment_status === 'unpaid' && <Badge tone="amber" className="ms-2">Unpaid</Badge>}</>}
            sub={[e.supplier_name ? e.description : null, e.reference, e.project?.name ?? 'General'].filter(Boolean).join(' · ')}
            line={editBtn(e, true)}
            right={<Money value={Number(e.amount) + Number(e.vat_amount)} className="text-[15px] font-semibold tracking-[-0.01em]" />} rightSub={formatShortDate(e.spent_on)} /> })}</MList>
        <div className="hidden sm:block"><TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Supplier / description</Th><Th>Invoice no.</Th><Th>Category</Th><Th>Payment</Th><Th className="text-right">Excl. VAT</Th><Th className="text-right">VAT</Th><Th className="text-right">Total</Th>{edit && <Th />}</tr></thead>
          <tbody className="divide-y divide-border">{data.map((e: any) => <tr key={e.id} className="hover:bg-surface-2/50" data-expense={e.reference ?? e.id}>
            <Td className="whitespace-nowrap tabular-nums">{e.spent_on}</Td>
            <Td><div className="max-w-[340px] truncate font-medium">{e.supplier_name ?? e.description}{badges(e)}</div><div className="max-w-[340px] truncate text-xs text-muted">{[e.supplier_name ? e.description : null, e.project?.name ?? 'General', e.employee?.full_name].filter(Boolean).join(' · ')}
              {e.receipt_document_id && <Link href={`/documents/${e.receipt_document_id}`} className="ms-2 inline-flex items-center gap-0.5 text-primary hover:underline"><Paperclip size={11} />receipt</Link>}
              {e.source === 'scan' && <span className="ms-2 inline-flex items-center gap-0.5" title="Entered from a scanned receipt"><ScanText size={11} aria-hidden />scanned</span>}</div></Td>
            <Td className="whitespace-nowrap font-mono text-[12.5px]">{e.reference ?? <span className="text-muted">—</span>}</Td>
            <Td>{EXPENSE_CATS[e.category] ?? e.category}</Td>
            <Td className="text-muted">{e.payment_status === 'unpaid' ? <span className="text-warning">Unpaid</span> : e.payment_method ? PAYMENT_METHODS[e.payment_method] : '—'}</Td>
            <Td className="text-right tabular-nums">{fmtMoney(e.amount)}</Td><Td className="text-right tabular-nums text-muted">{Number(e.vat_amount) ? fmtMoney(e.vat_amount) : '—'}</Td>
            <Td className="text-right font-medium tabular-nums">{fmtMoney(Number(e.amount) + Number(e.vat_amount))}</Td>
            {edit && <Td className="text-right"><div className="flex justify-end gap-1">{editBtn(e)}
              {c.can('records.delete') && !e.export_batch_id && <ActionButton variant="ghost" action={deleteExpense.bind(null, e.id)} confirm="Delete this expense? (The receipt stays in the Vault.)"><Trash2 size={13} /><span className="sr-only">Delete</span></ActionButton>}</div></Td>}</tr>)}</tbody></TableWrap></div></>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/expenses" />
    </Card>
    {edit && <Fab label="Quick create: expense" open="expense" />}
  </>
}
