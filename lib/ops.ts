import 'server-only'
import type { Ctx } from './auth'

export const PHOTO_ROLES: Record<string, string> = { photo_before: 'Before', photo_progress: 'Progress', photo_measurement: 'Measurement', photo_issue: 'Issue', photo_completed: 'Completed' }
export interface OpsDoc { id: string; name: string; notes: string | null; created_at: string; role: string; mime: string }

/** Photos and attachments linked to a site visit / work order / site report (soft-deleted documents excluded). */
export async function opsFiles(c: Ctx, kind: 'site_visit' | 'work_order' | 'site_report', id: string) {
  const { data } = await c.supabase.from('document_relationships')
    .select('role,document:documents(id,name,notes,created_at,deleted_at,version:document_versions!documents_current_version_fk(mime_type))')
    .eq('related_type', kind).eq('related_id', id).order('created_at', { ascending: true }).limit(300)
  const docs: OpsDoc[] = (data ?? []).map((r: any) => r.document && !r.document.deleted_at ? { id: r.document.id, name: r.document.name, notes: r.document.notes, created_at: r.document.created_at, role: r.role, mime: String(r.document.version?.mime_type ?? '') } : null).filter(Boolean) as OpsDoc[]
  return { photos: docs.filter(d => d.role.startsWith('photo') && d.mime.startsWith('image/')), files: docs.filter(d => !(d.role.startsWith('photo') && d.mime.startsWith('image/'))) }
}
