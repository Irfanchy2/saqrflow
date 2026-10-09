import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Ctx } from '@/lib/auth'
import { localDate } from '@/lib/time'
import { safeFileName, sha256Hex, validateUpload } from '@/lib/files'
import { UNKNOWN_TYPE } from '@/lib/inbox/catalog'

/**
 * Secure external links. The token (32 random bytes) is shown once when the link is created; the database keeps only its
 * SHA-256 hash. Every public page resolves the hash with the service role, checks expiry and revocation, and then reads
 * data with an explicit company filter AND the record the link was issued for. Nothing else is reachable through a link.
 */
export const LINK_KINDS = { customer_portal: 'Customer portal', supplier_portal: 'Supplier portal', document_request: 'Document request', quote_response: 'Quotation accept / reject' } as const
export type LinkKind = keyof typeof LINK_KINDS
export const LINK_PATH: Record<LinkKind, string> = { customer_portal: '/p', supplier_portal: '/s', document_request: '/r', quote_response: '/q' }

export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, '')
}

/** Absolute base URL for links and printed codes (configured app URL, else the host the request came in on). */
export async function baseUrl() {
  const fixed = appUrl(); if (fixed) return fixed
  const h = await headers(); const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  return `${h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')}://${host}`
}

/** A salted hash of the caller's IP (for rate limits and the link log). The raw address is never stored. */
export async function ipHash() {
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown'
  const salt = process.env.AVERIQO_MIDDLEWARE_SECRET || process.env.SUPABASE_SECRET_KEY || 'averiqo'
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)
}

export interface ResolvedLink {
  link: { id: string; company_id: string; kind: LinkKind; customer_id: string | null; supplier_id: string | null; employee_id: string | null; invoice_id: string | null; title: string | null; message: string | null; items: string[]; recipient_name: string | null; expires_at: string; use_count: number }
  company: { id: string; name: string; timezone: string; currency: string; locale: string }
  admin: ReturnType<typeof createAdminClient>
  /** read-only context for the audited sales / ledger loaders, which filter by company_id explicitly */
  ctx: Ctx
}

/** Returns the link if the token is valid, of the expected kind, not revoked and not expired; otherwise null. */
export async function resolveLink(token: string, kind: LinkKind): Promise<ResolvedLink | null> {
  if (!TOKEN_RE.test(token)) return null
  const admin = createAdminClient()
  const { data: link } = await admin.from('share_links').select('*').eq('token_hash', hashToken(token)).maybeSingle()
  if (!link || link.kind !== kind || link.revoked_at || new Date(link.expires_at).getTime() < Date.now()) return null
  const { data: co } = await admin.from('companies').select('id,name,timezone,currency,locale').eq('id', link.company_id).maybeSingle()
  if (!co) return null
  const company = { id: co.id, name: co.name, timezone: co.timezone ?? 'Asia/Dubai', currency: co.currency ?? 'AED', locale: co.locale ?? 'en' }
  const ctx = {
    supabase: admin as any, userId: '00000000-0000-0000-0000-000000000000', email: '',
    profile: { id: '', company_id: company.id, full_name: link.recipient_name ?? 'Portal visitor', role: 'viewer' as const, locale: 'en' },
    company, today: localDate(new Date().toISOString(), company.timezone), can: () => false,
  } as unknown as Ctx
  return { link: link as any, company, admin, ctx }
}

/** Records what happened through a link and bumps its usage counters. Never throws. */
export async function logLinkEvent(r: ResolvedLink, event: 'opened' | 'downloaded' | 'uploaded' | 'accepted' | 'rejected' | 'delivery_confirmed' | 'invoice_uploaded', detail?: string) {
  try {
    const ip = await ipHash()
    if (event === 'opened') {   // one "opened" per visitor per 30 minutes is enough
      const { count } = await r.admin.from('share_link_events').select('id', { count: 'exact', head: true }).eq('link_id', r.link.id).eq('event', 'opened').eq('ip_hash', ip).gte('created_at', new Date(Date.now() - 30 * 60e3).toISOString())
      if (count) return
    }
    await r.admin.from('share_link_events').insert({ company_id: r.company.id, link_id: r.link.id, event, detail: detail?.slice(0, 500) ?? null, ip_hash: ip })
    await r.admin.from('share_links').update({ last_used_at: new Date().toISOString(), use_count: r.link.use_count + 1 }).eq('id', r.link.id)
  } catch (e) { console.warn('[portal] log failed', (e as Error).message) }
}

/** At most `max` events of this kind per link per window (all visitors together). */
export async function underLimit(r: ResolvedLink, event: string, max: number, minutes: number) {
  const { count } = await r.admin.from('share_link_events').select('id', { count: 'exact', head: true }).eq('link_id', r.link.id).eq('event', event).gte('created_at', new Date(Date.now() - minutes * 60e3).toISOString())
  return (count ?? 0) < max
}

/** In-app notification to the link's creator and every active user with the given permission. */
export async function notifyCompany(r: ResolvedLink, perm: string, n: { title: string; body?: string; link: string; key: string; severity?: 'info' | 'warning' }) {
  try {
    const { data: users } = await r.admin.from('profiles').select('id, role').eq('company_id', r.company.id).eq('is_active', true)
    const { data: rp } = await r.admin.from('role_permissions').select('role').eq('permission', perm)
    const roles = new Set((rp ?? []).map(x => x.role))
    const ids = (users ?? []).filter(u => roles.has(u.role)).map(u => u.id)
    if (!ids.length) return
    await r.admin.from('in_app_notifications').upsert(ids.map(id => ({ company_id: r.company.id, user_id: id, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, link: n.link, severity: n.severity ?? 'info', dedupe_key: n.key.slice(0, 200) })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
  } catch (e) { console.warn('[portal] notify failed', (e as Error).message) }
}


/**
 * A file sent through a link goes to the Smart Inbox for review (never straight into a record): stored privately, marked
 * "needs review", with the person / company it came from pre-selected. Office staff confirm and file it as usual.
 */
export async function storeLinkUpload(r: ResolvedLink, f: File, note: string, owner: { kind: 'employee' | 'customer' | 'supplier'; id: string; name: string }): Promise<{ ok: true; id: string } | { error: string }> {
  const buf = new Uint8Array(await f.arrayBuffer())
  const chk = validateUpload({ name: f.name, size: f.size, type: f.type }, buf.slice(0, 16))
  if (!chk.ok) return { error: `${f.name}: ${chk.error}` }
  const id = crypto.randomUUID(), sha = sha256Hex(buf)
  const path = `${r.company.id}/inbox/${id}/${safeFileName(f.name)}`
  const up = await r.admin.storage.from('vault').upload(path, buf, { contentType: chk.mime, upsert: false })
  if (up.error) return { error: `${f.name}: upload failed, please try again.` }
  const suggestion = { docType: UNKNOWN_TYPE, label: 'Sent through a link', ownerKind: owner.kind, owner: { id: owner.id, name: owner.name, confidence: 1, reason: 'Sent through a secure link' }, ownerCandidates: [], path: [], category: '', duplicates: [], warnings: [] }
  const { error } = await r.admin.from('document_inbox').insert({ id, company_id: r.company.id, uploaded_by: null, source: 'upload', storage_path: path, file_name: f.name, mime_type: chk.mime, size_bytes: f.size, sha256: sha,
    status: 'needs_review', review_reasons: [note.slice(0, 300)], doc_type: UNKNOWN_TYPE, suggestion })
  if (error) { await r.admin.storage.from('vault').remove([path]); return { error: `${f.name}: could not be saved.` } }
  return { ok: true, id }
}
