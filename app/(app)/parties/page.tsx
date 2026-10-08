import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Download, Handshake, Plus, Upload } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Card, EmptyState, LinkButton, PageHeader, Pagination, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { PartyFields } from '@/components/parties/party-fields'
import { ImportForm } from '@/components/import-form'
import { createParty } from '@/app/actions/admin'
import { importParties } from '@/app/actions/imports'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Customers & Suppliers' }
export default async function Parties({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/'); const sp = await flat(searchParams)
  const kind = sp.tab === 'suppliers' ? 'suppliers' : 'customers', q = sanitizeQ(sp.q), page = pageOf(sp.page)
  let query = c.supabase.from(kind).select('id,name,contact_person,phone,email,trn', { count: 'exact' }).order('name').range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (q) query = query.or(`name.ilike.%${q}%,contact_person.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,trn.ilike.%${q}%`)
  const { data, count } = await query
  const isC = kind === 'customers', edit = c.can('records.edit')
  return <><PageHeader title="Customers & Suppliers" sub="Directory used by cheques, quotations, invoices and projects. Open a client for their ledger, documents and timeline."
    actions={<>
      {c.can('data.export') && <LinkButton href={`/api/export/${kind}`} variant="secondary"><Download size={14} />Export CSV</LinkButton>}
      {edit && <DialogButton wide variant="secondary" label="Import CSV" title={`Import ${isC ? 'clients' : 'suppliers'} from CSV`} icon={<Upload size={14} />}><ImportForm action={importParties.bind(null, kind)} columns="name, contact_person, phone, whatsapp, email, trn, address, notes" /></DialogButton>}
      {edit && <DialogButton wide openParam={isC ? 'customer' : 'supplier'} label={`Add ${isC ? 'client' : 'supplier'}`} title={`Add ${isC ? 'client' : 'supplier'}`} icon={<Plus size={15} />}>
        <ActionForm action={createParty.bind(null, kind)} resetOnSuccess><PartyFields customer={isC} create /></ActionForm></DialogButton>}</>} />
    <div className="mb-4 flex gap-1 border-b border-border">{[['customers', 'Clients'], ['suppliers', 'Suppliers']].map(([k, l]) => <Link key={k} href={`/parties?tab=${k}`} aria-current={kind === k ? 'page' : undefined} className={cn('-mb-px border-b-2 px-4 py-2 text-sm', kind === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted')}>{l}</Link>)}</div>
    <Card className="overflow-hidden">
      <form className="border-b border-border p-3"><input type="hidden" name="tab" value={kind} /><input name="q" type="search" defaultValue={sp.q} aria-label="Search" placeholder="Search name, contact, phone, email, TRN…" className="h-9 w-full max-w-md rounded-md border border-border bg-surface px-3 text-sm" /></form>
      {!data?.length ? <EmptyState icon={Handshake} title={q ? 'No matches' : `No ${isC ? 'clients' : 'suppliers'} yet`} body="Add the companies you trade with so cheques, invoices and projects can be linked to them." /> :
        <TableWrap><thead className="border-b border-border bg-surface-2/60"><tr><Th>Name</Th><Th>Contact</Th><Th>Phone</Th><Th>Email</Th><Th>TRN</Th></tr></thead><tbody className="divide-y divide-border">
          {data.map(p => <tr key={p.id} className="hover:bg-surface-2/50"><Td className="font-medium">{isC ? <Link href={`/parties/${p.id}`} className="text-primary hover:underline">{p.name}</Link> : p.name}</Td><Td className="text-muted">{p.contact_person ?? '—'}</Td><Td className="whitespace-nowrap text-muted">{p.phone ?? '—'}</Td><Td className="text-muted">{p.email ?? '—'}</Td><Td className="font-mono text-xs text-muted">{p.trn ?? '—'}</Td></tr>)}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/parties" />
    </Card></>
}
