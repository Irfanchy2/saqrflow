import 'server-only'
import type { Ctx } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ACTION_LABEL, changeSummary } from '@/lib/audit'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'

/**
 * Activity timeline for one record, built from the audit log (who created / changed / trashed it, and what changed).
 * Call it only from a page that has already loaded the record through the user's own (RLS) client: that is the access
 * check. Values are summarised by changeSummary, which hides confidential fields.
 */
export async function RecordActivity({ c, table, id, className, limit = 30 }: { c: Ctx; table: string; id: string; className?: string; limit?: number }) {
  const admin = createAdminClient()
  const { data: rows } = await admin.from('audit_logs').select('id,action,table_name,user_id,changes,created_at')
    .eq('company_id', c.company.id).in('table_name', [table, 'custom_field_values']).eq('record_id', id).order('created_at', { ascending: false }).limit(limit)
  const ids = [...new Set((rows ?? []).map(r => r.user_id).filter(Boolean))] as string[]
  const { data: people } = ids.length ? await admin.from('profiles').select('id,full_name').eq('company_id', c.company.id).in('id', ids) : { data: [] as any[] }
  const who = new Map((people ?? []).map(p => [p.id, p.full_name as string]))
  const items = (rows ?? []).map(r => {
    const changes = r.table_name === 'custom_field_values' ? { old: r.changes?.old ?? {}, new: r.changes?.new ?? {} } : r.changes
    const lines = changeSummary(r.table_name, r.table_name === 'custom_field_values' ? 'UPDATE' : r.action, changes)
    return { id: r.id, at: r.created_at as string, what: r.table_name === 'custom_field_values' ? 'Additional details updated' : ACTION_LABEL[r.action] ?? r.action, by: r.user_id ? who.get(r.user_id) ?? 'a former user' : 'the system', lines: r.action === 'INSERT' ? [] : lines }
  }).filter(x => x.what !== 'Edited' || x.lines.length)
  const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <Card className={className}><CardHeader title="Activity" sub="Every change to this record, from the audit log" />
    {!items.length ? <EmptyState title="No recorded activity yet" /> :
      <ol className="relative ms-6 border-s border-border py-3 pe-4">{items.map(x => <li key={x.id} className="mb-4 ms-4 last:mb-0">
        <span className="absolute -start-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary/60 ring-4 ring-surface" />
        <time className="text-xs tabular-nums text-muted">{fmt(x.at)}</time>
        <div className="text-sm"><span className="font-medium">{x.what}</span><span className="text-muted"> by {x.by}</span></div>
        {x.lines.length > 0 && <ul className="mt-0.5 space-y-0.5 text-xs text-muted">{x.lines.slice(0, 6).map((l, i) => <li key={i} className="break-words">{l}</li>)}{x.lines.length > 6 && <li>and {x.lines.length - 6} more</li>}</ul>}
      </li>)}</ol>}
  </Card>
}
