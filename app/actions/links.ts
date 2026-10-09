'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { LINK_KINDS, LINK_PATH, baseUrl, hashToken, newToken, type LinkKind } from '@/lib/portal'
import type { ActionState } from '@/lib/utils'

const UUID = /^[0-9a-f-]{36}$/i
type Target = 'customer' | 'supplier' | 'employee' | 'invoice'

/**
 * Creates a secure link and returns its URL ONCE (only the hash is stored). The target record must be visible to the user
 * (RLS), and links to commercial data need finance.view (enforced again by the share_links policies).
 */
export async function createShareLink(kind: string, target: Target, targetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    if (!(kind in LINK_KINDS) || !UUID.test(targetId)) return { error: 'Unknown record.' }
    const k = kind as LinkKind
    if (k !== 'document_request') need(c, 'finance.view')
    const days = z.coerce.number().int().min(1).max(365).parse(str(fd, 'days') ?? (k === 'quote_response' ? '30' : '90'))
    const items = k === 'document_request' ? [...new Set((str(fd, 'items') ?? '').split(/[\n,]/).map(x => x.trim()).filter(Boolean))].slice(0, 20).map(x => x.slice(0, 120)) : []
    if (k === 'document_request' && !items.length) return { error: 'List at least one document you need (e.g. Passport copy, Emirates ID).' }
    const table = target === 'invoice' ? 'invoices' : target === 'customer' ? 'customers' : target === 'supplier' ? 'suppliers' : 'employees'
    const { data: rec } = await c.supabase.from(table).select(target === 'invoice' ? 'id,doc_type,status,number' : target === 'employee' ? 'id,full_name' : 'id,name').eq('id', targetId).maybeSingle()
    if (!rec) return { error: 'Record not found.' }
    if (k === 'quote_response') {
      const q = rec as any
      if (q.doc_type !== 'quotation') return { error: 'Accept / reject links are for quotations.' }
      if (!['sent', 'viewed', 'follow_up'].includes(q.status)) return { error: 'Send the quotation first (status Sent), then share the accept / reject link.' }
    }
    if (k === 'document_request' && target === 'invoice') return { error: 'Document requests go to a person or company.' }
    if (k === 'quote_response' && target !== 'invoice') return { error: 'Accept / reject links are for quotations.' }
    if (k === 'customer_portal' && target !== 'customer') return { error: 'A customer portal belongs to a customer.' }
    if (k === 'supplier_portal' && target !== 'supplier') return { error: 'A supplier portal belongs to a supplier.' }
    const token = newToken()
    const row: Record<string, any> = {
      company_id: c.company.id, kind: k, token_hash: hashToken(token), created_by: c.userId, items,
      expires_at: new Date(Date.now() + days * 864e5).toISOString(), title: str(fd, 'title')?.slice(0, 200) ?? null, message: str(fd, 'message')?.slice(0, 2000) ?? null,
      recipient_name: str(fd, 'recipient_name')?.slice(0, 120) ?? null,
      [`${target === 'invoice' ? 'invoice' : target}_id`]: targetId,
    }
    const { error } = await c.supabase.from('share_links').insert(row)
    if (error) throw error
    const url = `${await baseUrl()}${LINK_PATH[k]}/${token}`
    revalidatePath('/', 'layout')
    return { ok: true, message: `Link created. It works until ${new Date(row.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`, data: { url } }
  })
}

export async function revokeShareLink(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    if (!UUID.test(id)) return { error: 'Unknown link.' }
    const { data, error } = await c.supabase.from('share_links').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Link not found or already switched off.' }
    revalidatePath('/', 'layout'); return { ok: true, message: 'Link switched off. It stops working immediately.' }
  })
}

/** Purchase order → supplier (for the supplier portal). */
export async function setPoSupplier(poId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'finance.view')
    const sid = str(fd, 'supplier_id') ?? null
    if (!UUID.test(poId) || (sid && !UUID.test(sid))) return { error: 'Unknown record.' }
    if (sid) { const { data: s } = await c.supabase.from('suppliers').select('id').eq('id', sid).maybeSingle(); if (!s) return { error: 'Supplier not found.' } }
    const { data, error } = await c.supabase.from('invoices').update({ supplier_id: sid }).eq('id', poId).eq('doc_type', 'purchase_order').select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Purchase order not found.' }
    revalidatePath(`/invoices/${poId}`); return { ok: true, message: sid ? 'Supplier linked.' : 'Supplier removed.' }
  })
}
