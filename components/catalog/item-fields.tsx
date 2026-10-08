import { Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { UNITS } from '@/lib/sales/docs'
import { VAT_CATEGORIES } from '@/lib/sales/money'

export function CatalogFields({ i }: { i?: Record<string, any> }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="Name *" className="sm:col-span-2"><Input name="name" required maxLength={200} defaultValue={i?.name ?? ''} placeholder="e.g. MS Handrail" /></Field>
    <Field label="Description" hint="Copied into the quotation line. Editable there" className="sm:col-span-2"><Textarea name="description" rows={3} maxLength={2000} defaultValue={i?.description ?? ''} /></Field>
    <Field label="Unit"><Select name="unit" defaultValue={i?.unit ?? 'Nos'}>{[...new Set([...UNITS, i?.unit ?? 'Nos'])].map(u => <option key={u}>{u}</option>)}</Select></Field>
    <Field label="Default rate (AED)"><Input name="rate" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={i?.rate ?? 0} /></Field>
    <Field label="VAT"><Select name="vat_category" defaultValue={i?.vat_category ?? 'standard'}>{Object.entries(VAT_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    <Field label="Category"><Input name="category" maxLength={80} defaultValue={i?.category ?? ''} placeholder="e.g. Railings" list="catalog-cats" /></Field>
    <Field label="Notes" className="sm:col-span-2"><Input name="notes" maxLength={1000} defaultValue={i?.notes ?? ''} /></Field>
  </div>
}
