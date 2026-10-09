import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeXlsxBook } from '@/lib/xlsx'
import { DEFS } from '@/lib/exports'
import { can, type Role } from '@/lib/permissions'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** Full backup: one Excel workbook with a sheet per list the user may export (their own RLS-scoped session). Audited. */
export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser(); if (!user) return new NextResponse('Your session has expired. Sign in again.', { status: 401 })
  const { data: me } = await sb.from('profiles').select('company_id, role, company:companies(timezone)').eq('id', user.id).single()
  if (!me || !can(me.role as Role, 'data.export')) return new NextResponse('You do not have permission to export data.', { status: 403 })
  const tz = (me.company as any)?.timezone ?? 'Asia/Dubai'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const allowed = Object.entries(DEFS).filter(([k, d]) => k !== 'reminder-log' && (!d.perm || can(me.role as Role, d.perm)))
  const sheets = await Promise.all(allowed.map(async ([, d]) => { const [headers, rows] = await d.run(sb, today); return { name: d.title, headers, rows } }))
  const total = sheets.reduce((a, s) => a + s.rows.length, 0)
  try { await createAdminClient().from('audit_logs').insert({ company_id: me.company_id, user_id: user.id, action: 'EXPORT', table_name: 'full-backup', changes: { rows: total, sheets: sheets.map(s => `${s.name}: ${s.rows.length}`) } }) } catch {}
  return new NextResponse(writeXlsxBook(sheets) as BodyInit, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="averiqo-backup-${today}.xlsx"`, 'Cache-Control': 'no-store' } })
}
