import 'server-only'
import type { Ctx } from './auth'

export interface TimelineEvent { date: string; title: string; detail?: string; href?: string; kind: 'issued' | 'uploaded' | 'version' | 'renewed' | 'reminder' }

/** Document history for one employee (ownerId) or the company (ownerId = null). RLS limits what each user sees. */
export async function documentTimeline(c: Ctx, owner: { type: 'employee' | 'company'; id?: string }): Promise<TimelineEvent[]> {
  let q = c.supabase.from('documents').select('id,name,issue_date,created_at,category:document_categories(name)').is('deleted_at', null).eq('owner_type', owner.type).limit(500)
  if (owner.id) q = q.eq('owner_id', owner.id)
  const { data: docs } = await q
  const ids = (docs ?? []).map(d => d.id)
  if (!ids.length) return []
  const [{ data: vers }, { data: ren }, { data: logs }] = await Promise.all([
    c.supabase.from('document_versions').select('document_id,version_no,created_at,note').in('document_id', ids).gt('version_no', 1),
    c.supabase.from('document_renewals').select('document_id,renewed_at,previous_expiry,new_expiry').in('document_id', ids),
    c.can('reminders.create') ? c.supabase.from('notification_logs').select('source_id,created_at,channel').eq('source_type', 'document').in('source_id', ids).eq('channel', 'in_app').limit(500) : Promise.resolve({ data: [] as any[] }),
  ])
  const name = (id: string) => (docs ?? []).find(d => d.id === id)?.name ?? 'Document'
  const ev: TimelineEvent[] = []
  for (const d of docs ?? []) {
    if (d.issue_date) ev.push({ date: d.issue_date, title: `${d.name} issued`, href: `/documents/${d.id}`, kind: 'issued' })
    ev.push({ date: d.created_at.slice(0, 10), title: `${d.name} uploaded`, detail: (d as any).category?.name, href: `/documents/${d.id}`, kind: 'uploaded' })
  }
  for (const v of vers ?? []) ev.push({ date: v.created_at.slice(0, 10), title: `${name(v.document_id)} — version ${v.version_no} added`, detail: v.note ?? undefined, href: `/documents/${v.document_id}`, kind: 'version' })
  for (const r of ren ?? []) ev.push({ date: r.renewed_at, title: `${name(r.document_id)} renewed`, detail: `${r.previous_expiry ?? '—'} → ${r.new_expiry}`, href: `/documents/${r.document_id}`, kind: 'renewed' })
  for (const l of logs ?? []) ev.push({ date: l.created_at.slice(0, 10), title: `Renewal reminder sent — ${name(l.source_id)}`, href: `/documents/${l.source_id}`, kind: 'reminder' })
  return ev.sort((a, b) => b.date.localeCompare(a.date))
}
