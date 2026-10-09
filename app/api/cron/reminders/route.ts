import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runReminderCycle } from '@/lib/reminders/engine'
import { processEvents, deliverWebhooks } from '@/lib/event-worker'
import { runDueSchedules } from '@/lib/scheduled-reports'
import { recordRun } from '@/lib/system-runs'
import { safeEqual } from '@/lib/crypto'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Scheduler entry point (Vercel Cron calls it every morning with `Authorization: Bearer $CRON_SECRET`). Idempotent:
 * events → rule alerts / webhooks, due scheduled reports, then reminders (which also sends everything queued).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return NextResponse.json({ error: 'CRON_SECRET is not configured on the server' }, { status: 503 })
  const got = req.headers.get('authorization') ?? ''
  if (!safeEqual(got, `Bearer ${secret}`)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const started = Date.now(), admin = createAdminClient()
  try {
    const r = await recordRun(admin, 'cron', async () => {
      const events = await processEvents(admin, 1000)
      const reports = await runDueSchedules(admin)
      const reminders = await runReminderCycle(admin)
      const webhooks = await deliverWebhooks(admin, 100)
      return { events, reports, webhooks, ...reminders }
    })
    return NextResponse.json({ ok: true, ms: Date.now() - started, ...r })
  } catch (e) { console.error('[cron/reminders]', e); return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }) }
}
export const GET = handle, POST = handle
