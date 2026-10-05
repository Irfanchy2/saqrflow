'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { saveVersion } from '@/lib/doc-upload'
import { ASSET_DOCS, VEHICLE_DOCS } from '@/lib/assets'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const t = (max: number) => z.string().trim().max(max).optional()
const schema = z.object({
  kind: z.enum(['vehicle', 'equipment', 'machinery', 'tool', 'office', 'other']),
  name: z.string().trim().min(2, 'Name is required').max(200),
  status: z.enum(['active', 'in_maintenance', 'out_of_service', 'sold', 'disposed']).default('active'),
  // vehicle
  plate_or_serial: t(60), plate_emirate: t(40), vehicle_type: t(40), make: t(60), model: t(60),
  model_year: z.coerce.number().int().min(1950).max(2100).optional(), mulkiya_no: t(60), insurance_provider: t(120),
  registration_expiry: date.optional(), insurance_expiry: date.optional(),
  // asset
  category: t(80), asset_code: t(40), serial_no: t(80), purchase_date: date.optional(),
  purchase_price: z.coerce.number().min(0).max(1e10).optional(), supplier_name: t(200), location: t(200),
  warranty_expiry: date.optional(), next_service_date: date.optional(),
  assigned_to: z.string().uuid().optional(), notes: t(4000),
})
const KEYS = Object.keys(schema.shape)
const parse = (fd: FormData) => schema.parse(Object.fromEntries(KEYS.map(k => [k, str(fd, k)])))
const touch = (id?: string) => { revalidatePath('/assets'); if (id) revalidatePath(`/assets/${id}`); revalidatePath('/') }

export async function createAsset(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = parse(fd)
    const { data, error } = await c.supabase.from('assets').insert({ ...v, company_id: c.company.id, created_by: c.userId }).select('id').single()
    if (error) { if (error.code === '23505') return { error: `Asset ID “${v.asset_code}” is already used.` }; throw error }
    id = data.id; touch()
  })
  if (id) redirect(`/assets/${id}`)
  return r
}

export async function updateAsset(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = parse(fd)
    // empty optional fields clear the stored value
    const cleared = Object.fromEntries(KEYS.filter(k => !['kind', 'name', 'status'].includes(k)).map(k => [k, (v as Record<string, unknown>)[k] ?? null]))
    const { data, error } = await c.supabase.from('assets').update({ ...v, ...cleared, updated_at: new Date().toISOString() }).eq('id', id).select('id')
    if (error) { if (error.code === '23505') return { error: `Asset ID “${v.asset_code}” is already used.` }; throw error }
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
    touch(id); return { ok: true, message: archived ? 'Archived — reminders for it have stopped.' : 'Restored.' }
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
    if (errors.length) return { error: `${files.length - errors.length} uploaded. Rejected — ${errors.join(' · ')}` }
    return { ok: true, message: `${files.length} file${files.length === 1 ? '' : 's'} uploaded${expiry ? ' — expiry reminders created' : ''}.` }
  })
}
