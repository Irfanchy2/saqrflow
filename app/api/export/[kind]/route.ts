import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toCsv } from '@/lib/csv'
import { writeXlsx } from '@/lib/xlsx'
import { can, type Role } from '@/lib/permissions'
import { DEFS } from '@/lib/exports'

/** CSV or Excel exports (?format=xlsx). Requires `data.export`; rows come from the caller's own RLS-scoped session. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const def = DEFS[kind]; if (!def) return new NextResponse('Unknown export', { status: 404 })
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser(); if (!user) return new NextResponse('Your session has expired. Sign in again.', { status: 401 })
  const { data: me } = await sb.from('profiles').select('company_id, role, company:companies(timezone)').eq('id', user.id).single()
  if (!me || !can(me.role as Role, 'data.export') || (def.perm && !can(me.role as Role, def.perm))) return new NextResponse('You do not have permission to export this list.', { status: 403 })
  const tz = (me.company as any)?.timezone ?? 'Asia/Dubai'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const [headers, rows] = await def.run(sb, today)
  try { await createAdminClient().from('audit_logs').insert({ company_id: me.company_id, user_id: user.id, action: 'EXPORT', table_name: kind, changes: { rows: rows.length } }) } catch {}
  const xlsx = req.nextUrl.searchParams.get('format') === 'xlsx', name = `averiqo-${kind}-${today}.${xlsx ? 'xlsx' : 'csv'}`
  const body = xlsx ? writeXlsx(def.title, headers, rows) : toCsv(headers, rows)
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } })
}
