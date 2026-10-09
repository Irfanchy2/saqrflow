import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Records a scheduler run (job, timing, ok / short error) so Settings → Backup status can show whether jobs are healthy. */
export async function recordRun<T>(admin: SupabaseClient, job: 'cron' | 'events', fn: () => Promise<T>): Promise<T> {
  const { data: run } = await admin.from('system_runs').insert({ job }).select('id').single()
  const started = Date.now()
  try {
    const r = await fn()
    if (run) await admin.from('system_runs').update({ finished_at: new Date().toISOString(), ok: true, detail: `${Date.now() - started} ms` }).eq('id', run.id)
    return r
  } catch (e) {
    if (run) await admin.from('system_runs').update({ finished_at: new Date().toISOString(), ok: false, detail: String((e as Error).message ?? e).slice(0, 300) }).eq('id', run.id)
    throw e
  }
}
