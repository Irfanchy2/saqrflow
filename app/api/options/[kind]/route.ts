import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/auth'

/** Choices for form dropdowns (id + name), fetched when a form is opened rather than sent with every page. RLS scopes them. */
export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const c = await getCtx()
  const q = kind === 'customers' ? c.supabase.from('customers').select('id,name').order('name').limit(2000)
    : kind === 'employees' ? (c.can('employees.view') ? c.supabase.from('employees').select('id,name:full_name').eq('status', 'active').order('full_name').limit(1000) : null)
    : kind === 'users' ? c.supabase.from('profiles').select('id,name:full_name').eq('is_active', true).order('full_name')
    : undefined
  if (q === undefined) return NextResponse.json({ error: 'unknown list' }, { status: 404 })
  if (q === null) return NextResponse.json({ options: [] }, { headers: { 'Cache-Control': 'private, max-age=60' } })
  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'failed' }, { status: 500 })
  return NextResponse.json({ options: data ?? [] }, { headers: { 'Cache-Control': 'private, max-age=60' } })
}
