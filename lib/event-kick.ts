import 'server-only'
import { after } from 'next/server'

/**
 * Runs the event worker right after the response is sent (Next `after`), so rule alerts and webhooks go out within
 * seconds of a change instead of waiting for the daily scheduler. The scheduler still sweeps anything left over.
 */
export function scheduleEventWork() {
  try {
    after(async () => {
      try {
        const [{ runEventWork }, { createAdminClient }] = await Promise.all([import('./event-worker'), import('./supabase/admin')])
        await runEventWork(createAdminClient())
      } catch (e) { console.warn('[events] after()', (e as Error).message) }
    })
  } catch { /* outside a request (tests, scripts): the scheduler picks the events up */ }
}
