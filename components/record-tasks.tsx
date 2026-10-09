import Link from 'next/link'
import { Plus } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { TaskFields } from '@/components/crm/fields'
import { createTask } from '@/app/actions/operations'
import { TASK_STATUS, isOverdue } from '@/lib/crm'
import { formatShortDate } from '@/lib/time'

type RelType = 'customer' | 'supplier' | 'employee' | 'document' | 'vehicle' | 'asset' | 'invoice' | 'quotation' | 'project'

/** Tasks linked to one record, with "Add task" pre-linked to it. Uses the shared task list (tasks.related_type / related_id). */
export async function RecordTasks({ c, type, id, title, projectId, className }: { c: Ctx; type: RelType; id: string; title?: string; projectId?: string | null; className?: string }) {
  const edit = c.can('records.edit')
  const [{ data: tasks }, users, emps] = await Promise.all([
    c.supabase.from('tasks').select('id,title,status,due_date').eq('related_type', type).eq('related_id', id).is('deleted_at', null).order('due_date', { nullsFirst: false }).limit(50),
    edit ? c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name') : Promise.resolve({ data: [] as any[] }),
    edit && c.can('employees.view') ? c.supabase.from('employees').select('id,full_name').eq('status', 'active').order('full_name').limit(500) : Promise.resolve({ data: [] as any[] }),
  ])
  const o = (rows: any[]) => rows.map(r => ({ id: r.id, name: r.full_name }))
  return <Card className={className}><CardHeader title="Tasks" action={edit ? <DialogButton wide size="sm" variant="secondary" label="Add task" title="Add task" icon={<Plus size={14} />}><ActionForm action={createTask} submit="Add task" idempotent>
    <TaskFields users={o(users.data ?? [])} employees={o(emps.data ?? [])} projects={[]} fixed={{ related_type: type, related_id: id, ...(projectId ? { project_id: projectId } : {}) }} t={{ due_date: c.today, title: title?.slice(0, 200) }} /></ActionForm></DialogButton> : undefined} />
    {!(tasks ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No tasks linked to this record.</p>
      : <ul className="divide-y divide-border text-sm">{(tasks ?? []).map((t: any) => { const od = isOverdue(t, c.today)
        return <li key={t.id}><Link href={`/tasks?view=open&open=${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
          <span className="min-w-0 flex-1 truncate">{t.title}</span>{t.due_date && <span className={od ? 'text-xs font-medium tabular-nums text-danger' : 'text-xs tabular-nums text-muted'}>{formatShortDate(t.due_date)}</span>}
          <Badge tone={od ? 'red' : TASK_STATUS[t.status]?.tone}>{od ? 'Overdue' : TASK_STATUS[t.status]?.label}</Badge></Link></li> })}</ul>}
  </Card>
}
