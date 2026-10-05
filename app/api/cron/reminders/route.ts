import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runReminderCycle } from '@/lib/reminders/engine'
import { safeEqual } from '@/lib/crypto'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** Scheduler entry point. Call every 5–15 min with `Authorization: Bearer $CRON_SECRET` (Vercel Cron does this automatically). Idempotent. */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return NextResponse.json({ error: 'CRON_SECRET is not configured on the server' }, { status: 503 })
  const got = req.headers.get('authorization') ?? ''
  if (!safeEqual(got, `Bearer ${secret}`)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const started = Date.now()
  try { const r = await runReminderCycle(createAdminClient()); return NextResponse.json({ ok: true, ms: Date.now() - started, ...r }) }
  catch (e) { console.error('[cron/reminders]', e); return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }) }
}
export const GET = handle, POST = handle
