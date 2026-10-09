'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { BASE_STATUSES, CUSTOM_ENTITIES, ENTITY_TABLE, FIELD_TYPES, STATUS_ENTITIES, STATUS_TABLE, fieldKey, parseCustomValues, type CustomEntity, type FieldDef, type StatusEntity } from '@/lib/custom'
import type { ActionState } from '@/lib/utils'

const isEntity = (e: string): e is CustomEntity => e in CUSTOM_ENTITIES
const UUID = /^[0-9a-f-]{36}$/i

// ───────────── Settings: definitions ─────────────
export async function saveFieldDef(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const v = z.object({
      entity: z.enum(Object.keys(CUSTOM_ENTITIES) as [CustomEntity, ...CustomEntity[]]),
      label: z.string().trim().min(1, 'Label is required').max(60),
      field_type: z.enum(Object.keys(FIELD_TYPES) as [string, ...string[]]),
      required: z.boolean(),
    }).parse({ entity: str(fd, 'entity'), label: str(fd, 'label') ?? '', field_type: str(fd, 'field_type'), required: fd.get('required') === 'on' })
    const options = v.field_type === 'select' ? [...new Set((str(fd, 'options') ?? '').split(/[,\n]/).map(o => o.trim()).filter(Boolean))].slice(0, 50).map(o => o.slice(0, 60)) : []
    if (v.field_type === 'select' && options.length < 2) return { error: 'A dropdown needs at least two options (separate them with commas).' }
    const { count } = await c.supabase.from('custom_field_defs').select('id', { count: 'exact', head: true }).eq('entity', v.entity)
    if ((count ?? 0) >= 30) return { error: 'Up to 30 custom fields per record type.' }
    const { error } = await c.supabase.from('custom_field_defs').insert({ company_id: c.company.id, entity: v.entity, key: fieldKey(v.label), label: v.label, field_type: v.field_type, options, required: v.required, position: count ?? 0 })
    if (error) { if (error.code === '23505') return { error: 'A field with that name already exists for this record type.' }; throw error }
    revalidatePath('/settings'); return { ok: true, message: `Added “${v.label}” to ${CUSTOM_ENTITIES[v.entity].toLowerCase()}.` }
  })
}

/** Hiding keeps the stored values (show the field again to see them); nothing is deleted. */
export async function setFieldActive(id: string, active: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    if (!UUID.test(id)) return { error: 'Unknown field.' }
    const { error } = await c.supabase.from('custom_field_defs').update({ active }).eq('id', id)
    if (error) throw error
    revalidatePath('/settings'); return { ok: true, message: active ? 'Field shown again.' : 'Field hidden. Saved values are kept.' }
  })
}

export async function saveCustomStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const entity = z.enum(Object.keys(STATUS_ENTITIES) as [StatusEntity, ...StatusEntity[]]).parse(str(fd, 'entity'))
    const label = z.string().trim().min(1, 'Name is required').max(40).parse(str(fd, 'label') ?? '')
    const base = str(fd, 'base_status') ?? ''
    if (!(base in BASE_STATUSES[entity])) return { error: 'Choose which standard status it counts as.' }
    const color = z.enum(['neutral', 'blue', 'green', 'amber', 'red']).parse(str(fd, 'color') ?? 'neutral')
    const { count } = await c.supabase.from('custom_statuses').select('id', { count: 'exact', head: true }).eq('entity', entity)
    const { error } = await c.supabase.from('custom_statuses').insert({ company_id: c.company.id, entity, label, base_status: base, color, position: count ?? 0 })
    if (error) { if (error.code === '23505') return { error: 'That status name already exists.' }; throw error }
    revalidatePath('/settings'); return { ok: true, message: `Added status “${label}”.` }
  })
}

export async function setCustomStatusActive(id: string, active: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    if (!UUID.test(id)) return { error: 'Unknown status.' }
    const { error } = await c.supabase.from('custom_statuses').update({ active }).eq('id', id)
    if (error) throw error
    revalidatePath('/settings'); return { ok: true, message: active ? 'Status available again.' : 'Status retired. Records keep it until changed.' }
  })
}

// ───────────── records: values + custom status ─────────────
export async function saveCustomValues(entity: string, recordId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    if (!isEntity(entity) || !UUID.test(recordId)) return { error: 'Unknown record.' }
    // the record must be visible to this user (RLS) before its custom values can change
    const { data: rec } = await c.supabase.from(ENTITY_TABLE[entity]).select('id').eq('id', recordId).maybeSingle()
    if (!rec) return { error: 'Record not found.' }
    const { data: defs } = await c.supabase.from('custom_field_defs').select('*').eq('entity', entity)
    const r = parseCustomValues((defs ?? []) as FieldDef[], k => fd.get(k))
    if ('error' in r) return { error: r.error }
    const { data: cur } = await c.supabase.from('custom_field_values').select('data').eq('entity', entity).eq('record_id', recordId).maybeSingle()
    const data = { ...(cur?.data ?? {}), ...r.values }   // values of hidden fields are kept
    const { error } = await c.supabase.from('custom_field_values').upsert({ company_id: c.company.id, entity, record_id: recordId, data, updated_by: c.userId, updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath('/', 'layout'); return { ok: true, message: 'Saved.' }
  })
}

export async function setCustomStatus(entity: string, recordId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    if (!(entity in STATUS_ENTITIES) || !UUID.test(recordId)) return { error: 'Unknown record.' }
    const id = str(fd, 'custom_status_id') ?? null
    if (id && !UUID.test(id)) return { error: 'Unknown status.' }
    const { data, error } = await c.supabase.from(STATUS_TABLE[entity as StatusEntity]).update({ custom_status_id: id }).eq('id', recordId).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Record not found.' }
    revalidatePath('/', 'layout'); return { ok: true, message: id ? 'Status updated.' : 'Custom status cleared.' }
  })
}
