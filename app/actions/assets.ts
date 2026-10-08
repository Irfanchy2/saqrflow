'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { saveVersion } from '@/lib/doc-upload'
import { ASSET_DOCS, ASSET_STATUS_KEYS, VEHICLE_DOCS } from '@/lib/assets'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const t = (max: number) => z.string().trim().max(max).optional()
const schema = z.object({
  kind: z.enum(['vehicle', 'equipment', 'machinery', 'tool', 'office', 'other']),
  name: z.string().trim().min(2, 'Name is required').max(200),
  status: z.enum(ASSET_STATUS_KEYS).default('active'),
  // vehicle
  plate_or_serial: t(60), plate_emirate: t(40), vehicle_type: t(40), make: t(60), model: t(60),
  model_year: z.coerce.number().int().min(1950).max(2100).optional(), mulkiya_no: t(60), insurance_provider: t(120),
  vin: t(40), current_mileage: z.coerce.number({ message: 'Mileage must be a number' }).int().min(0).max(5_000_000).optional(),
  service_interval_km: z.coerce.number({ message: 'Service interval must be a number' }).int().min(100, 'Service interval: at least 100 km').max(200_000).optional(),
  registration_expiry: date.optional(), insurance_expiry: date.optional(), inspection_expiry: date.optional(),
  // asset
  category: t(80), asset_code: t(40), serial_no: t(80), purchase_date: date.optional(),
  purchase_price: z.coerce.number().min(0).max(1e10).optional(), supplier_name: t(200), location: t(200),
  warranty_expiry: date.optional(), next_service_date: date.optional(), condition: z.enum(['new', 'good', 'fair', 'poor', 'damaged']).optional(),
  assigned_to: z.string().uuid().optional(), notes: t(4000),
  reminder_days: z.string().max(60).optional().transform((v, ctx) => {
    if (!v) return undefined
    const n = v.split(/[,\s]+/).filter(Boolean).map(Number)
    if (n.some(x => !Number.isInteger(x) || x < 0 || x > 365)) { ctx.addIssue({ code: 'custom', message: 'Reminder days: whole numbers 0–365, e.g. 30, 7, 1' }); return z.NEVER }
    return [...new Set(n)].sort((a, b) => b - a).slice(0, 8)
  }),
})
const KEYS = Object.keys(schema.shape)
const parse = (fd: FormData) => schema.safeParse(Object.fromEntries(KEYS.map(k => [k, str(fd, k)])))
const invalid = (e: z.ZodError): ActionState => ({ error: e.issues[0].message, fieldErrors: Object.fromEntries(e.issues.map(i => [i.path.join('.'), i.message])) })
// mileage typed on the form is dated today; the next mileage-based service follows from the interval
const withMileage = (v: z.infer<typeof schema>, today: string, prev?: { current_mileage?: number | null }) => ({
  ...v, ...(v.current_mileage != null && v.current_mileage !== prev?.current_mileage ? { mileage_updated_on: today } : {}),
  ...(v.current_mileage != null && v.service_interval_km ? { next_service_km: v.current_mileage + v.service_interval_km } : {}),
})
const touch = (id?: string) => { revalidatePath('/assets'); if (id) revalidatePath(`/assets/${id}`); revalidatePath('/') }

export async function createAsset(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = parse(fd); if (!p.success) return invalid(p.error)
    const v = withMileage(p.data, c.today)
    if (v.assigned_to && v.status === 'active') v.status = 'assigned'
    const token = z.string().uuid().safeParse(str(fd, 'idempotency_key')).data ?? null
    if (token) { const { data: dup } = await c.supabase.from('assets').select('id').eq('client_token', token).maybeSingle(); if (dup) { id = dup.id; return } }
    const { data, error } = await c.supabase.from('assets').insert({ ...v, client_token: token, company_id: c.company.id, created_by: c.userId }).select('id').single()
    if (error) { if (error.code === '23505' && token) { const { data: dup } = await c.supabase.from('assets').select('id').eq('client_token', token).maybeSingle(); if (dup) { id = dup.id; return } }
      if (error.code === '23505') return { error: `Asset code “${v.asset_code}” is already used.`, fieldErrors: { asset_code: "Already used" } }; throw error }
    id = data.id; touch()
  })
  if (id) redirect(`/assets/${id}`)
  return r
}

export async function updateAsset(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = parse(fd); if (!p.success) return invalid(p.error)
    const { data: prev } = await c.supabase.from('assets').select('current_mileage,next_service_km').eq('id', id).maybeSingle()
    const v = withMileage(p.data, c.today, prev ?? undefined)
    // empty optional fields clear the stored value
    const cleared = Object.fromEntries(KEYS.filter(k => !['kind', 'name', 'status'].includes(k)).map(k => [k, (v as Record<string, unknown>)[k] ?? null]))
    if (!v.service_interval_km) Object.assign(cleared, { next_service_km: prev?.next_service_km ?? null })
    const { data, error } = await c.supabase.from('assets').update({ ...v, ...cleared, updated_at: new Date().toISOString() }).eq('id', id).select('id')
    if (error) { if (error.code === '23505') return { error: `Asset code “${v.asset_code}” is already used.`, fieldErrors: { asset_code: "Already used" } }; throw error }
    if (!data?.length) return { error: 'Not found or not allowed.' }
    touch(id); return { ok: true, message: 'Saved.' }
  })
}

/** Archive keeps the record, its documents and history; reminders stop. Restore brings it back. */
export async function setAssetArchived(id: string, archived: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data, error } = await c.supabase.from('assets').update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Not found or not allowed.' }
    touch(id); return { ok: true, message: archived ? 'Archived. Reminders for it have stopped.' : 'Restored.' }
  })
}

/** Mulkiya, insurance, inspection, maintenance… stored as private versioned documents linked to the asset (with optional expiry reminders). */
export async function uploadAssetFiles(assetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) return { error: 'Choose at least one file.' }
    if (files.length > 10) return { error: 'Upload up to 10 files at a time.' }
    const { data: a } = await c.supabase.from('assets').select('id,name,kind,plate_or_serial').eq('id', assetId).maybeSingle()
    if (!a) return { error: 'Not found.' }
    const docs: Record<string, string> = a.kind === 'vehicle' ? VEHICLE_DOCS : ASSET_DOCS
    const type = z.enum(Object.keys(docs) as [string, ...string[]]).catch('other').parse(str(fd, 'doc_type'))
    const expiry = str(fd, 'expiry_date'); if (expiry) date.parse(expiry)
    const ref = str(fd, 'reference_no')?.slice(0, 100) ?? null
    const errors: string[] = []
    for (const f of files) {
      const { data: doc, error } = await c.supabase.from('documents').insert({
        company_id: c.company.id, owner_type: 'asset', owner_id: assetId, name: `${docs[type]} – ${a.name}`.slice(0, 250), reference_no: ref,
        expiry_date: expiry ?? null, reminders_active: !!expiry, folder: `${a.kind === 'vehicle' ? 'Vehicles' : 'Assets'}/${(a.plate_or_serial || a.name).replace(/[\\/]/g, '-')}/${docs[type]}`,
        created_by: c.userId, responsible_user_id: c.userId,
      }).select('id').single()
      if (error) throw error
      try { await saveVersion(c, doc.id, f) } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`)
        await c.supabase.from('documents').update({ deleted_at: new Date().toISOString(), deleted_by: c.userId }).eq('id', doc.id)
        continue
      }
      await c.supabase.from('document_relationships').insert({ company_id: c.company.id, document_id: doc.id, related_type: a.kind === 'vehicle' ? 'vehicle' : 'asset', related_id: assetId, role: type, created_by: c.userId })
    }
    touch(assetId); revalidatePath('/vault')
    if (errors.length) return { error: `${files.length - errors.length} uploaded. Rejected: ${errors.join(' · ')}` }
    return { ok: true, message: `${files.length} file${files.length === 1 ? '' : 's'} uploaded${expiry ? '. Expiry reminders created' : ''}.` }
  })
}

const maintSchema = z.object({
  performed_on: date, kind: z.enum(['service', 'repair', 'inspection', 'other']), description: z.string().trim().min(1, 'Describe the work').max(1000),
  cost: z.coerce.number({ message: 'Cost must be a number' }).min(0, 'Cost cannot be negative').max(1e9).default(0).transform(n => Math.round(n * 100) / 100),
  vendor: t(200), odometer: z.coerce.number().int().min(0).max(5_000_000).optional(), employee_id: z.string().uuid().optional(), next_due: date.optional(),
})
/** Maintenance / repair / inspection record. The DB trigger updates the asset's last & next service (and inspection) dates → reminders follow. */
export async function addMaintenance(assetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const r = maintSchema.safeParse(Object.fromEntries(['performed_on', 'kind', 'description', 'cost', 'vendor', 'odometer', 'employee_id', 'next_due'].map(k => [k, str(fd, k)])))
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: Object.fromEntries(r.error.issues.map(i => [i.path.join('.'), i.message])) }
    const v = r.data
    if (v.performed_on > c.today) return { error: 'The date cannot be in the future.', fieldErrors: { performed_on: 'In the future' } }
    if (v.next_due && v.next_due <= v.performed_on) return { error: 'The next due date must be after the work date.', fieldErrors: { next_due: 'Too early' } }
    let documentId: string | null = null
    const f = fd.get('file')
    if (f instanceof File && f.size > 0 && c.can('documents.upload')) {
      const { data: d, error: de } = await c.supabase.from('documents').insert({ company_id: c.company.id, owner_type: 'asset', owner_id: assetId, name: `${v.kind[0].toUpperCase()}${v.kind.slice(1)}: ${v.description}`.slice(0, 250), issue_date: v.performed_on, folder: 'Assets/Maintenance', reminders_active: false, created_by: c.userId }).select('id').single()
      if (de) throw de
      try { await saveVersion(c, d.id, f) } catch (e) { await c.supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', d.id); return { error: `Not saved. The attachment was rejected: ${(e as Error).message}` } }
      documentId = d.id
    }
    const { error } = await c.supabase.from('asset_maintenance').insert({ ...v, company_id: c.company.id, asset_id: assetId, document_id: documentId, created_by: c.userId })
    if (error) throw error
    // a completed service / repair brings the item back from the workshop (assigned items stay assigned)
    if (v.kind === 'repair' || v.kind === 'service') {
      const { data: a } = await c.supabase.from('assets').select('assigned_to,status').eq('id', assetId).maybeSingle()
      if (a && ['in_maintenance', 'in_repair'].includes(a.status)) await c.supabase.from('assets').update({ status: a.assigned_to ? 'assigned' : 'available' }).eq('id', assetId)
    }
    touch(assetId); return { ok: true, message: 'Maintenance recorded.' }
  })
}

const assignSchema = z.object({
  employee_id: z.string().uuid().optional(), project_id: z.string().uuid().optional(), location: t(200),
  assigned_on: date, note: t(500),
}).refine(v => v.employee_id || v.project_id || v.location, { message: 'Choose an employee, a project or a location', path: ['employee_id'] })
/**
 * Hand a vehicle / asset to an employee (and optionally a project or location). The assets trigger closes the previous
 * assignment and opens a new history row in the same transaction; this action then adds the project, date and note to it.
 */
export async function assignAsset(assetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const r = assignSchema.safeParse(Object.fromEntries(['employee_id', 'project_id', 'location', 'assigned_on', 'note'].map(k => [k, str(fd, k)])))
    if (!r.success) return invalid(r.error)
    const v = r.data
    if (v.assigned_on > c.today) return { error: 'The assignment date cannot be in the future.', fieldErrors: { assigned_on: 'In the future' } }
    const { data: a } = await c.supabase.from('assets').select('id,status,assigned_to,location').eq('id', assetId).maybeSingle()
    if (!a) return { error: 'Not found.' }
    const status = ['active', 'available', 'assigned'].includes(a.status) ? 'assigned' : a.status
    // a re-assignment to the same employee still closes the previous row: clear first, then set
    if (a.assigned_to && a.assigned_to === v.employee_id) await c.supabase.from('assets').update({ assigned_to: null }).eq('id', assetId)
    const { error } = await c.supabase.from('assets').update({ assigned_to: v.employee_id ?? null, location: v.location ?? a.location, status, updated_at: new Date().toISOString() }).eq('id', assetId)
    if (error) throw error
    if (!v.employee_id) {   // project / location only: no trigger row, record it directly
      await c.supabase.from('asset_assignments').update({ returned_on: v.assigned_on }).eq('asset_id', assetId).is('returned_on', null)
      const { error: ie } = await c.supabase.from('asset_assignments').insert({ company_id: c.company.id, asset_id: assetId, project_id: v.project_id ?? null, location: v.location ?? null, assigned_on: v.assigned_on, note: v.note ?? null })
      if (ie) throw ie
    } else {
      await c.supabase.from('asset_assignments').update({ project_id: v.project_id ?? null, location: v.location ?? null, assigned_on: v.assigned_on, note: v.note ?? null }).eq('asset_id', assetId).is('returned_on', null)
    }
    touch(assetId); return { ok: true, message: 'Assignment recorded.' }
  })
}
/** Return to the yard / store: closes the open assignment; the item becomes Available (unless it is in the workshop). */
export async function returnAsset(assetId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data: a } = await c.supabase.from('assets').select('status').eq('id', assetId).maybeSingle()
    if (!a) return { error: 'Not found.' }
    const { error } = await c.supabase.from('assets').update({ assigned_to: null, status: a.status === 'assigned' ? 'available' : a.status, updated_at: new Date().toISOString() }).eq('id', assetId)
    if (error) throw error
    await c.supabase.from('asset_assignments').update({ returned_on: c.today }).eq('asset_id', assetId).is('returned_on', null)
    touch(assetId); return { ok: true, message: 'Returned. The item is available again.' }
  })
}
