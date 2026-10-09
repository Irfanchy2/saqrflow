import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runEventWork } from '@/lib/event-worker'
import { recordRun } from '@/lib/system-runs'
import { safeEqual } from '@/lib/crypto'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** Optional frequent sweep (e.g. an external cron every 5 minutes): webhook retries and queued alerts. Same CRON_SECRET. */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return NextResponse.json({ error: 'CRON_SECRET is not configured on the server' }, { status: 503 })
  if (!safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  try {
    const r = await recordRun(admin, 'events', async () => { const x = await runEventWork(admin); if (!x) throw new Error('Event worker failed (see the server log)'); return x })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }) }
}
export const GET = handle, POST = handle
