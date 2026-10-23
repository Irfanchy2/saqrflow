import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/** Downloads a Tally export exactly as it was created (stored with the batch; the same bytes every time). */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await getCtx().catch(() => null)
  if (!c) return new NextResponse('Your session has expired. Sign in again.', { status: 401 })
  if (!c.can('finance.view') || !c.can('data.export')) return new NextResponse('You do not have permission to download Tally exports.', { status: 403 })
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse('Not found', { status: 404 })
  const { data } = await c.supabase.from('expense_exports').select('ref,file_name,content,released_at').eq('id', id).maybeSingle()
  if (!data) return new NextResponse('Not found', { status: 404 })
  try { await createAdminClient().from('audit_logs').insert({ company_id: c.company.id, user_id: c.userId, action: 'EXPORT', table_name: 'expense_exports', record_id: id, changes: { download: data.ref, released: !!data.released_at } }) } catch {}
  return new NextResponse(data.content, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${data.file_name}"`, 'Cache-Control': 'no-store' } })
}
