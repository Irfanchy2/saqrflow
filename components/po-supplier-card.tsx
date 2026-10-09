import type { Ctx } from '@/lib/auth'
import { Card, CardHeader, Field, Select } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { setPoSupplier } from '@/app/actions/links'
import { ShareLinks } from './share-links'

/** Purchase order → supplier, delivery confirmation status, and the supplier portal link for that supplier. */
export async function PoSupplierCard({ c, po }: { c: Ctx; po: { id: string; supplier_id?: string | null; customer_name?: string | null; supplier_confirmed_at?: string | null; supplier_confirmation?: any } }) {
  if (!c.can('finance.view')) return null
  const { data: sups } = await c.supabase.from('suppliers').select('id,name').order('name').limit(1000)
  const guess = !po.supplier_id && po.customer_name ? (sups ?? []).find(s => s.name.trim().toLowerCase() === po.customer_name!.trim().toLowerCase())?.id : undefined
  const cur = (sups ?? []).find(s => s.id === po.supplier_id)
  const conf = po.supplier_confirmation
  return <>
    <Card><CardHeader title="Supplier" sub={po.supplier_confirmed_at ? `Delivery confirmed by ${conf?.by ?? 'the supplier'} for ${conf?.delivered_on ?? ''}${conf?.reference ? ` · DN ${conf.reference}` : ''}` : 'Link the supplier to share this order through the supplier portal'} />
      <div className="p-4">{c.can('records.edit') ? <ActionForm action={setPoSupplier.bind(null, po.id)} resetOnSuccess={false} submit="Save supplier" variant="secondary">
        <Field label="Supplier" hint={guess ? 'matched by name, check and save' : undefined}><Select name="supplier_id" defaultValue={po.supplier_id ?? guess ?? ''}><option value="">Not linked</option>{(sups ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      </ActionForm> : <p className="text-sm">{cur?.name ?? 'Not linked'}</p>}</div></Card>
    {cur && <ShareLinks c={c} kind="supplier_portal" target="supplier" targetId={cur.id} recipient={cur.name} sub={`${cur.name} sees the purchase orders addressed to them, confirms deliveries and uploads invoices (reviewed in Smart Inbox).`} shareText={`Purchase orders from ${c.company.name}`} />}
  </>
}
