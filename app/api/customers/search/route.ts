import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/auth'
import { sanitizeQ } from '@/lib/queries'

/**
 * Customer search for the document builder's picker: up to 30 matches on name, TRN, phone, contact or e-mail, with the
 * fields the builder copies onto the document. Row-level security scopes it to the signed-in company.
 */
export async function GET(req: Request) {
  const c = await getCtx()
  if (!c.can('finance.view')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const t = sanitizeQ(new URL(req.url).searchParams.get('q') ?? '')
  let q = c.supabase.from('customers').select('id,name,address,trn,phone,contact_person,email').order('name').limit(30)
  if (t) q = q.or(`name.ilike.%${t}%,trn.ilike.%${t}%,phone.ilike.%${t}%,contact_person.ilike.%${t}%,email.ilike.%${t}%`)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'search failed' }, { status: 500 })
  return NextResponse.json({ customers: data ?? [] }, { headers: { 'Cache-Control': 'private, max-age=15' } })
}
