import { Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { TICKET_CATEGORY, TICKET_PRIORITY, TICKET_SOURCE } from '@/lib/service'

type Opt = { id: string; name: string }
const opts = (list: Opt[], none = 'Not set') => [<option key="" value="">{none}</option>, ...list.map(o => <option key={o.id} value={o.id}>{o.name}</option>)]

/** Service ticket add / edit. The warranty is found automatically from the customer / project when left empty. */
export function TicketFields({ t = {}, customers, projects, assets, users, employees, warranties, fixedCustomer }: {
  t?: Record<string, any>; customers: Opt[]; projects: Opt[]; assets: Opt[]; users: Opt[]; employees: Opt[]; warranties: Opt[]; fixedCustomer?: string
}) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="Issue *" className="sm:col-span-2"><Input name="title" required minLength={3} maxLength={200} defaultValue={t.title} placeholder="e.g. Sliding gate not closing fully" /></Field>
    <Field label="Details" className="sm:col-span-2"><Textarea name="description" rows={3} maxLength={4000} defaultValue={t.description ?? ''} /></Field>
    {fixedCustomer ? <input type="hidden" name="customer_id" value={fixedCustomer} /> : <Field label="Customer"><Select name="customer_id" defaultValue={t.customer_id ?? ''}>{opts(customers)}</Select></Field>}
    <Field label="Project"><Select name="project_id" defaultValue={t.project_id ?? ''}>{opts(projects)}</Select></Field>
    <Field label="Category"><Select name="category" defaultValue={t.category ?? 'repair'}>{Object.entries(TICKET_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    <Field label="Priority" hint="sets the due date when empty: urgent 1 day, high 2, normal 5, low 10"><Select name="priority" defaultValue={t.priority ?? 'normal'}>{Object.entries(TICKET_PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</Select></Field>
    <Field label="Reported via"><Select name="source" defaultValue={t.source ?? 'phone'}>{Object.entries(TICKET_SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    <Field label="Vehicle / equipment"><Select name="asset_id" defaultValue={t.asset_id ?? ''}>{opts(assets, 'None')}</Select></Field>
    <Field label="Contact name"><Input name="contact_name" maxLength={120} defaultValue={t.contact_name ?? ''} /></Field>
    <Field label="Contact phone"><Input name="contact_phone" type="tel" maxLength={40} defaultValue={t.contact_phone ?? ''} /></Field>
    <Field label="Site / location" className="sm:col-span-2"><Input name="site_location" maxLength={300} defaultValue={t.site_location ?? ''} /></Field>
    <Field label="Assigned to (user)"><Select name="assigned_to" defaultValue={t.assigned_to ?? ''}>{opts(users)}</Select></Field>
    <Field label="Technician (employee)"><Select name="employee_id" defaultValue={t.employee_id ?? ''}>{opts(employees)}</Select></Field>
    <Field label="Visit date"><Input name="scheduled_date" type="date" defaultValue={t.scheduled_date ?? ''} /></Field>
    <Field label="Due date"><Input name="due_date" type="date" defaultValue={t.due_date ?? ''} /></Field>
    <Field label="Warranty" hint="found automatically when left empty"><Select name="warranty_id" defaultValue={t.warranty_id ?? ''}>{opts(warranties, 'Find automatically')}</Select></Field>
    <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="chargeable" defaultChecked={!!t.chargeable} />Chargeable (not covered)</label>
  </div>
}

export function WarrantyFields({ w = {}, customers, projects, invoices }: { w?: Record<string, any>; customers: Opt[]; projects: Opt[]; invoices: Opt[] }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="What is covered *" className="sm:col-span-2"><Input name="title" required maxLength={200} defaultValue={w.title} placeholder="e.g. Staircase structure, welds and paint" /></Field>
    <Field label="Customer"><Select name="customer_id" defaultValue={w.customer_id ?? ''}>{opts(customers)}</Select></Field>
    <Field label="Project"><Select name="project_id" defaultValue={w.project_id ?? ''}>{opts(projects)}</Select></Field>
    <Field label="Invoice"><Select name="invoice_id" defaultValue={w.invoice_id ?? ''}>{opts(invoices)}</Select></Field>
    <Field label="Start date *"><Input name="start_date" type="date" required defaultValue={w.start_date ?? ''} /></Field>
    <Field label="End date" hint="or choose a length"><Input name="end_date" type="date" defaultValue={w.end_date ?? ''} /></Field>
    {!w.id && <Field label="Length"><Select name="months" defaultValue="12"><option value="6">6 months</option><option value="12">1 year</option><option value="24">2 years</option><option value="36">3 years</option><option value="60">5 years</option><option value="120">10 years</option></Select></Field>}
    <Field label="Terms" className="sm:col-span-2"><Textarea name="terms" rows={3} maxLength={4000} defaultValue={w.terms ?? ''} placeholder="Covers manufacturing defects. Excludes misuse, impact damage and changes by others." /></Field>
  </div>
}
