'use client'
import { ActionForm } from '@/components/ui/action-form'
import type { ActionState } from '@/lib/utils'

/** CSV / Excel import: validates every row on the server, skips existing records and reports rejected rows by number. */
export function ImportForm({ action, columns }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; columns: string }) {
  return <ActionForm action={action} submit="Import" resetOnSuccess>
    <p className="text-sm text-muted">Upload a <b>.csv</b> or <b>.xlsx</b> file. The first row must contain column names: <code className="text-xs">{columns}</code>. Existing records (same name / number) are skipped, never overwritten.</p>
    <input type="file" name="file" required accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="File to import" className="text-sm" />
  </ActionForm>
}
