import { Field, Input, Textarea } from '@/components/ui/primitives'

/** Customer / supplier form fields (create + edit). Customers also get credit terms and an opening balance. */
export function PartyFields({ p, customer = true, create = false }: { p?: Record<string, any>; customer?: boolean; create?: boolean }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label={customer ? 'Customer / company name *' : 'Supplier name *'}><Input name="name" required minLength={2} maxLength={200} defaultValue={p?.name ?? ''} /></Field>
    <Field label="Contact person"><Input name="contact_person" maxLength={120} defaultValue={p?.contact_person ?? ''} /></Field>
    <Field label="Phone"><Input name="phone" type="tel" inputMode="tel" maxLength={40} defaultValue={p?.phone ?? ''} placeholder="+971 …" /></Field>
    <Field label="WhatsApp"><Input name="whatsapp" type="tel" inputMode="tel" maxLength={40} defaultValue={p?.whatsapp ?? ''} placeholder="+971 5x xxx xxxx" /></Field>
    <Field label="Email"><Input name="email" type="email" maxLength={200} defaultValue={p?.email ?? ''} /></Field>
    <Field label="TRN" hint="15 digits"><Input name="trn" inputMode="numeric" maxLength={30} defaultValue={p?.trn ?? ''} /></Field>
    <Field label="Address" className="sm:col-span-2"><Textarea name="address" rows={2} maxLength={500} defaultValue={p?.address ?? ''} /></Field>
    {customer && <>
      <Field label="Credit terms (days)" hint="Due date for new invoices"><Input name="credit_days" type="number" min={0} max={365} defaultValue={p?.credit_days ?? ''} placeholder="e.g. 30" /></Field>
      <Field label="Opening balance (AED)" hint="Amount owed before using SaqrFlow"><Input name="opening_balance" type="number" step="0.01" defaultValue={p?.opening_balance ?? ''} /></Field>
      <Field label="Opening balance date"><Input name="opening_balance_date" type="date" defaultValue={p?.opening_balance_date ?? ''} /></Field>
    </>}
    <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" maxLength={2000} defaultValue={p?.notes ?? ''} /></Field>
    {create && <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="confirm_duplicate" className="mt-0.5 h-4 w-4" />This is a different {customer ? 'customer' : 'supplier'} even if a similar one exists (only tick after a “possible duplicate” warning)</label>}
  </div>
}
