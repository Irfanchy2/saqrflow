import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { saveCustomStatus, saveFieldDef, setCustomStatusActive, setFieldActive } from '@/app/actions/custom'
import { BASE_STATUSES, CUSTOM_ENTITIES, FIELD_TYPES, STATUS_COLORS, STATUS_ENTITIES, type StatusEntity } from '@/lib/custom'

/** Settings → Custom fields & statuses. Fields appear in "Additional details" on the record page; statuses map to a standard one. */
export async function CustomFieldsSettings({ c }: { c: Ctx }) {
  const [{ data: defs }, { data: statuses }] = await Promise.all([
    c.supabase.from('custom_field_defs').select('*').order('entity').order('position'),
    c.supabase.from('custom_statuses').select('*').order('entity').order('position'),
  ])
  return <Card id="custom"><CardHeader title="Custom fields & statuses" sub="Add your own fields to records, and your own status names. Changes are audit-logged." />
    <div className="divide-y divide-border">
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-medium">Custom fields</h3>
        {!(defs ?? []).length ? <p className="text-sm text-muted">None yet. Example: “Site supervisor” on projects, “Shoe size” on employees, “Plot number” on customers.</p>
          : <ul className="divide-y divide-border rounded-md border border-border text-sm">{(defs ?? []).map((d: any) => <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1"><span className={d.active ? 'font-medium' : 'font-medium text-muted line-through'}>{d.label}</span>
              <span className="block text-xs text-muted">{CUSTOM_ENTITIES[d.entity as keyof typeof CUSTOM_ENTITIES]} · {FIELD_TYPES[d.field_type as keyof typeof FIELD_TYPES]}{d.required ? ' · required' : ''}{d.options?.length ? ` · ${d.options.join(', ')}` : ''}</span></span>
            <ActionButton variant="ghost" action={setFieldActive.bind(null, d.id, !d.active)}>{d.active ? 'Hide' : 'Show'}</ActionButton></li>)}</ul>}
        <ActionForm action={saveFieldDef} submit="Add field" variant="secondary">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Record type"><Select name="entity" defaultValue="project">{Object.entries(CUSTOM_ENTITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Field name *"><Input name="label" required maxLength={60} placeholder="e.g. Site supervisor" /></Field>
            <Field label="Type"><Select name="field_type" defaultValue="text">{Object.entries(FIELD_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Dropdown options" hint="comma separated, dropdown only"><Input name="options" maxLength={2000} placeholder="Small, Medium, Large" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" />Required when the details are saved</label>
        </ActionForm>
      </div>
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-medium">Custom statuses</h3>
        <p className="text-xs text-muted">Each custom status counts as one of the standard statuses, so overdue tasks, open projects, the sales pipeline and reports keep working.</p>
        {(statuses ?? []).length > 0 && <ul className="divide-y divide-border rounded-md border border-border text-sm">{(statuses ?? []).map((s: any) => <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Badge tone={STATUS_COLORS[s.color]}>{s.label}</Badge>
          <span className="min-w-0 flex-1 text-xs text-muted">{STATUS_ENTITIES[s.entity as StatusEntity]} · counts as {BASE_STATUSES[s.entity as StatusEntity]?.[s.base_status] ?? s.base_status}{s.active ? '' : ' · retired'}</span>
          <ActionButton variant="ghost" action={setCustomStatusActive.bind(null, s.id, !s.active)}>{s.active ? 'Retire' : 'Restore'}</ActionButton></li>)}</ul>}
        {(Object.keys(STATUS_ENTITIES) as StatusEntity[]).map(e => <details key={e} className="rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm">Add a status for {STATUS_ENTITIES[e].toLowerCase()}</summary>
          <div className="border-t border-border p-3"><ActionForm action={saveCustomStatus} submit="Add status" variant="secondary"><input type="hidden" name="entity" value={e} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name *"><Input name="label" required maxLength={40} placeholder={e === 'task' ? 'e.g. Waiting for material' : e === 'lead' ? 'e.g. Drawing approval' : 'e.g. Painting'} /></Field>
              <Field label="Counts as"><Select name="base_status">{Object.entries(BASE_STATUSES[e]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Field label="Colour"><Select name="color" defaultValue="blue">{['neutral', 'blue', 'green', 'amber', 'red'].map(k => <option key={k} value={k}>{k === 'neutral' ? 'Grey' : k[0].toUpperCase() + k.slice(1)}</option>)}</Select></Field>
            </div></ActionForm></div></details>)}
      </div>
    </div></Card>
}
