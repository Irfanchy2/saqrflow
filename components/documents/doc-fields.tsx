import { Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { ACCEPT_ATTR } from '@/lib/files'

export interface Cat { id: string; name: string; scope: string }
export interface Person { id: string; full_name: string }
type Defaults = Partial<{ name: string; category_id: string; reference_no: string; issuing_authority: string; issue_date: string; expiry_date: string; responsible_user_id: string; renewal_fee: number | string; notes: string; folder: string; reminder_days: number[] }>

export function DocFields({ categories, people, d = {}, company, withFile = true, fileRequired = false }: {
  categories: Cat[]; people: Person[]; d?: Defaults; company?: string; withFile?: boolean; fileRequired?: boolean
}) {
  return <>
    {company && <Field label="Company"><Input value={company} readOnly disabled /></Field>}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Document name *" className="sm:col-span-2"><Input name="name" defaultValue={d.name} required maxLength={250} placeholder="e.g. Trade License 2026" /></Field>
      <Field label="Category *"><Select name="category_id" defaultValue={d.category_id ?? ''} required><option value="" disabled>Choose…</option>
        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="Reference number"><Input name="reference_no" defaultValue={d.reference_no} maxLength={100} /></Field>
      <Field label="Issuing authority"><Input name="issuing_authority" defaultValue={d.issuing_authority} placeholder="e.g. DED, GDRFA, ICP" /></Field>
      <Field label="Responsible person"><Select name="responsible_user_id" defaultValue={d.responsible_user_id ?? ''}><option value="">Me</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select></Field>
      <Field label="Issue date"><Input type="date" name="issue_date" defaultValue={d.issue_date} /></Field>
      <Field label="Expiry date"><Input type="date" name="expiry_date" defaultValue={d.expiry_date} /></Field>
      <Field label="Renewal fee (AED)"><Input type="number" name="renewal_fee" step="0.01" min="0" defaultValue={d.renewal_fee} /></Field>
      <Field label="Reminder days before expiry" hint="Optional. e.g. 120, 60, 30, 7. Blank = category / company default."><Input name="reminder_days" defaultValue={d.reminder_days?.join(', ')} /></Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={d.notes} maxLength={4000} /></Field>
      {withFile && <Field label="File" hint="PDF, JPG, PNG, WEBP, DOC(X), XLS(X) · max 15 MB" className="sm:col-span-2">
        <input type="file" name="file" accept={ACCEPT_ATTR} required={fileRequired} className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary" /></Field>}
    </div>
  </>
}
