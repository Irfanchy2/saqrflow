import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { saveCustomValues, setCustomStatus } from '@/app/actions/custom'
import { BASE_STATUSES, STATUS_COLORS, STATUS_ENTITIES, displayValue, type CustomEntity, type FieldDef, type StatusEntity } from '@/lib/custom'

/**
 * "Additional details" on a record page: the company's custom fields (Settings → Custom fields) and, for tasks, projects,
 * leads and work orders, the custom status. Renders nothing when the company has none configured.
 */
export async function CustomFieldsCard({ c, entity, recordId, customStatusId, className }: { c: Ctx; entity: CustomEntity; recordId: string; customStatusId?: string | null; className?: string }) {
  const hasStatus = entity in STATUS_ENTITIES
  const [{ data: defsRaw }, { data: vals }, { data: statuses }] = await Promise.all([
    c.supabase.from('custom_field_defs').select('*').eq('entity', entity).eq('active', true).order('position'),
    c.supabase.from('custom_field_values').select('data').eq('entity', entity).eq('record_id', recordId).maybeSingle(),
    hasStatus ? c.supabase.from('custom_statuses').select('id,label,base_status,color,active').eq('entity', entity).order('position') : Promise.resolve({ data: [] as any[] }),
  ])
  const defs = (defsRaw ?? []) as FieldDef[], data = (vals?.data ?? {}) as Record<string, unknown>
  const st = (statuses ?? []).filter((s: any) => s.active || s.id === customStatusId)
  if (!defs.length && !st.length) return null
  const edit = c.can('records.edit'), cur = st.find((s: any) => s.id === customStatusId)
  return <Card className={className}><CardHeader title="Additional details" sub="Fields your company added in Settings" action={cur ? <Badge tone={STATUS_COLORS[cur.color]}>{cur.label}</Badge> : undefined} />
    <div className="space-y-4 p-4">
      {st.length > 0 && (edit ? <ActionForm action={setCustomStatus.bind(null, entity, recordId)} resetOnSuccess={false} submit="Set status" variant="secondary">
        <Field label="Status" hint="each custom status counts as a standard one for overdue, reports and the pipeline">
          <Select name="custom_status_id" defaultValue={customStatusId ?? ''}><option value="">Standard status only</option>
            {st.map((s: any) => <option key={s.id} value={s.id}>{s.label} ({BASE_STATUSES[entity as StatusEntity][s.base_status] ?? s.base_status})</option>)}</Select></Field></ActionForm>
        : cur && <p className="text-sm">Status: {cur.label}</p>)}
      {defs.length > 0 && (edit ? <ActionForm action={saveCustomValues.bind(null, entity, recordId)} resetOnSuccess={false} submit="Save details">
        <div className="grid gap-3 sm:grid-cols-2">{defs.map(d => { const v = data[d.key], name = `cf_${d.key}`, label = `${d.label}${d.required ? ' *' : ''}`
          if (d.field_type === 'checkbox') return <label key={d.id} className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name={name} defaultChecked={v === true} />{d.label}</label>
          if (d.field_type === 'textarea') return <div key={d.id} className="sm:col-span-2"><Field label={label}><Textarea name={name} rows={3} maxLength={4000} defaultValue={(v as string) ?? ''} required={d.required} /></Field></div>
          if (d.field_type === 'select') return <Field key={d.id} label={label}><Select name={name} defaultValue={(v as string) ?? ''} required={d.required}><option value="">—</option>{d.options.map(o => <option key={o} value={o}>{o}</option>)}</Select></Field>
          return <Field key={d.id} label={label}><Input name={name} type={d.field_type === 'number' ? 'number' : d.field_type === 'date' ? 'date' : 'text'} step={d.field_type === 'number' ? 'any' : undefined} maxLength={d.field_type === 'text' ? 300 : undefined} defaultValue={v === null || v === undefined ? '' : String(v)} required={d.required} /></Field>
        })}</div></ActionForm>
        : <dl className="grid gap-3 text-sm sm:grid-cols-2">{defs.map(d => <div key={d.id}><dt className="text-xs text-muted">{d.label}</dt><dd className="break-words">{displayValue(d, data[d.key])}</dd></div>)}</dl>)}
    </div></Card>
}
