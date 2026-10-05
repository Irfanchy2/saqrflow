import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Handshake, Plus } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat, sanitizeQ } from '@/lib/queries'
import { Card, EmptyState, Field, Input, PageHeader, Td, Th, TableWrap, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { createParty } from '@/app/actions/admin'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Clients & Suppliers' }
export default async function Parties({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/'); const sp = await flat(searchParams)
  const kind = sp.tab === 'suppliers' ? 'suppliers' : 'customers'; const q = sanitizeQ(sp.q)
  let query = c.supabase.from(kind).select('*').order('name').limit(200); if (q) query = query.or(`name.ilike.%${q}%,contact_person.ilike.%${q}%`)
  const { data } = await query
  return <><PageHeader title="Clients & Suppliers" sub="Directory used by cheques (and by invoicing and projects in Phase 2)."
    actions={c.can('records.edit') ? <DialogButton wide label={`Add ${kind === 'customers' ? 'client' : 'supplier'}`} title={`Add ${kind === 'customers' ? 'client' : 'supplier'}`} icon={<Plus size={15} />}>
      <ActionForm action={createParty.bind(null, kind)}><div className="grid gap-4 sm:grid-cols-2"><Field label="Name *"><Input name="name" required /></Field><Field label="Contact person"><Input name="contact_person" /></Field>
        <Field label="Phone"><Input name="phone" inputMode="tel" /></Field><Field label="Email"><Input name="email" type="email" /></Field><Field label="Tax registration no. (TRN)"><Input name="trn" /></Field><Field label="Address"><Input name="address" /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" /></Field></div></ActionForm></DialogButton> : undefined} />
    <div className="mb-4 flex gap-1 border-b border-border">{[['customers', 'Clients'], ['suppliers', 'Suppliers']].map(([k, l]) => <Link key={k} href={`/parties?tab=${k}`} className={cn('-mb-px border-b-2 px-4 py-2 text-sm', kind === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted')}>{l}</Link>)}</div>
    <form className="mb-4"><input type="hidden" name="tab" value={kind} /><input name="q" defaultValue={sp.q} placeholder="Search name or contact…" className="h-9 w-full max-w-sm rounded-md border border-border bg-surface px-3 text-sm" /></form>
    <Card className="overflow-hidden">{!data?.length ? <EmptyState icon={Handshake} title={q ? 'No matches' : `No ${kind === 'customers' ? 'clients' : 'suppliers'} yet`} body="Add the companies you trade with so cheques and (soon) invoices can be linked to them." /> :
      <TableWrap><thead className="border-b border-border bg-surface-2/60"><tr><Th>Name</Th><Th>Contact</Th><Th>Phone</Th><Th>Email</Th><Th>TRN</Th></tr></thead><tbody className="divide-y divide-border">
        {data.map(p => <tr key={p.id} className="hover:bg-surface-2/50"><Td className="font-medium">{p.name}</Td><Td className="text-muted">{p.contact_person ?? '—'}</Td><Td className="text-muted">{p.phone ?? '—'}</Td><Td className="text-muted">{p.email ?? '—'}</Td><Td className="font-mono text-xs text-muted">{p.trn ?? '—'}</Td></tr>)}</tbody></TableWrap>}</Card></>
}
