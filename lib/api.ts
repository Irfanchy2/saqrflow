import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from './supabase/admin'

// Read-only REST API (docs/API.md). Keys are shown once; only their SHA-256 is stored. Every query filters by the key's
// company explicitly (the service role bypasses RLS) and returns a fixed list of non-sensitive fields.

export const SCOPES = {
  'customers.read': 'Customers', 'invoices.read': 'Tax invoices', 'quotations.read': 'Quotations', 'payments.read': 'Payments received',
  'projects.read': 'Projects', 'leads.read': 'Leads', 'tickets.read': 'Service tickets',
} as const
export type Scope = keyof typeof SCOPES

export const newApiKey = () => `avq_${randomBytes(30).toString('base64url')}`
export const hashApiKey = (k: string) => createHash('sha256').update(k).digest('hex')
const KEY_RE = /^avq_[A-Za-z0-9_-]{40}$/

type Res = { scope: Scope; table: string; fields: string; filter?: (q: any) => any; softDelete?: boolean }
export const RESOURCES: Record<string, Res> = {
  customers: { scope: 'customers.read', table: 'customers', fields: 'id,name,contact_person,phone,email,trn,address,credit_days,created_at', softDelete: true },
  invoices: { scope: 'invoices.read', table: 'invoices', fields: 'id,number,status,issue_date,due_date,customer_id,customer_name,project_id,subtotal,vat_amount,total,created_at', filter: q => q.eq('doc_type', 'invoice'), softDelete: true },
  quotations: { scope: 'quotations.read', table: 'invoices', fields: 'id,number,status,issue_date,valid_until,customer_id,customer_name,project_id,subject,subtotal,vat_amount,total,created_at', filter: q => q.eq('doc_type', 'quotation'), softDelete: true },
  payments: { scope: 'payments.read', table: 'payments', fields: 'id,invoice_id,amount,paid_on,method,reference,created_at' },
  projects: { scope: 'projects.read', table: 'projects', fields: 'id,code,name,status,customer_id,location,start_date,expected_completion,fabrication_progress,site_progress,created_at', softDelete: true },
  leads: { scope: 'leads.read', table: 'leads', fields: 'id,number,company_name,contact_person,stage,source,service,estimated_value,expected_close,customer_id,created_at', softDelete: true },
  tickets: { scope: 'tickets.read', table: 'service_tickets', fields: 'id,number,title,status,priority,category,source,customer_id,project_id,due_date,under_warranty,created_at,resolved_at', softDelete: true },
}

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })

/** Resolves the Bearer key → company + scopes, or an error response. Records last use. */
export async function authenticate(req: NextRequest): Promise<{ companyId: string; scopes: string[] } | NextResponse> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!m || !KEY_RE.test(m[1])) return err(401, 'unauthorized', 'Send your API key as: Authorization: Bearer avq_…')
  const admin = createAdminClient()
  const { data: k } = await admin.from('api_keys').select('id,company_id,scopes,expires_at,revoked_at,use_count').eq('key_hash', hashApiKey(m[1])).maybeSingle()
  if (!k || k.revoked_at || (k.expires_at && new Date(k.expires_at) < new Date())) return err(401, 'unauthorized', 'This API key is not valid (unknown, revoked or expired).')
  await admin.from('api_keys').update({ last_used_at: new Date().toISOString(), use_count: Number(k.use_count ?? 0) + 1 }).eq('id', k.id)
  return { companyId: k.company_id, scopes: k.scopes }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const encodeCursor = (r: { created_at: string; id: string }) => Buffer.from(`${r.created_at}|${r.id}`).toString('base64url')
function decodeCursor(c: string): { ts: string; id: string } | null {
  try { const [ts, id] = Buffer.from(c, 'base64url').toString().split('|'); return ts && !Number.isNaN(Date.parse(ts)) && UUID.test(id) ? { ts, id } : null } catch { return null }
}

/** GET /api/v1/:resource — oldest first, keyset pagination (?cursor=… from `next_cursor`), ?limit ≤ 100, ?created_after=ISO date. */
export async function listResource(req: NextRequest, name: string) {
  const res = RESOURCES[name]; if (!res) return err(404, 'not_found', `Unknown resource. Available: ${Object.keys(RESOURCES).join(', ')}`)
  const auth = await authenticate(req); if (auth instanceof NextResponse) return auth
  if (!auth.scopes.includes(res.scope)) return err(403, 'forbidden', `This key does not have the ${res.scope} scope.`)
  const sp = req.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? 50) || 50))
  let q = createAdminClient().from(res.table).select(res.fields).eq('company_id', auth.companyId)
  if (res.filter) q = res.filter(q)
  if (res.softDelete) q = q.is('deleted_at', null)
  const after = sp.get('created_after'); if (after) { if (Number.isNaN(Date.parse(after))) return err(400, 'bad_request', 'created_after must be an ISO date'); q = q.gte('created_at', new Date(after).toISOString()) }
  const cur = sp.get('cursor')
  if (cur) { const c = decodeCursor(cur); if (!c) return err(400, 'bad_request', 'Invalid cursor'); q = q.or(`created_at.gt."${c.ts}",and(created_at.eq."${c.ts}",id.gt.${c.id})`) }
  const { data, error } = await q.order('created_at').order('id').limit(limit + 1)
  if (error) { console.error('[api]', error.message); return err(500, 'server_error', 'The request could not be completed.') }
  const rows = (data ?? []) as unknown as { created_at: string; id: string }[], page = rows.slice(0, limit)
  return NextResponse.json({ data: page, next_cursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null }, { headers: { 'Cache-Control': 'no-store' } })
}

/** GET /api/v1/:resource/:id */
export async function getResource(req: NextRequest, name: string, id: string) {
  const res = RESOURCES[name]; if (!res) return err(404, 'not_found', 'Unknown resource.')
  const auth = await authenticate(req); if (auth instanceof NextResponse) return auth
  if (!auth.scopes.includes(res.scope)) return err(403, 'forbidden', `This key does not have the ${res.scope} scope.`)
  if (!UUID.test(id)) return err(404, 'not_found', 'Not found.')
  let q = createAdminClient().from(res.table).select(res.fields).eq('company_id', auth.companyId).eq('id', id)
  if (res.filter) q = res.filter(q)
  if (res.softDelete) q = q.is('deleted_at', null)
  const { data } = await q.maybeSingle()
  return data ? NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } }) : err(404, 'not_found', 'Not found.')
}
