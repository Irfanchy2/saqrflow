'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { safe, str } from '@/lib/action'
import { getMe } from '@/lib/me'
import type { Ctx } from '@/lib/auth'
import type { ActionState } from '@/lib/utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { scanUpload, sha256Hex, storagePath, validateUpload } from '@/lib/files'
import { securityEvent } from '@/lib/security'
import { normRef } from '@/lib/expenses/suppliers'
import { formatShortDate } from '@/lib/time'
import { companyCards } from '@/lib/cards'

// Employee Portal actions. Everything runs as the signed-in employee (RLS: only their own claims, only while pending or
// sent back for correction; decisions are impossible from here). The receipt file is the one exception: after it is
// checked here it is stored by the server as the claim's own document, so an employee never needs upload rights to the
// company's document vault.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const money2 = (n: number) => Math.round(n * 100) / 100
const line = z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().positive().max(1e7).nullable().optional(), unit_price: z.number().min(0).max(1e10).nullable().optional(), amount: z.number().min(0).max(1e10) })
const jsonOf = <T,>(schema: z.ZodType<T>, fallback: T) => z.string().optional().transform((s, ctx) => {
  if (!s) return fallback
  try { const r = schema.safeParse(JSON.parse(s)); if (r.success) return r.data } catch {}
  ctx.addIssue({ code: 'custom', message: 'The line items could not be read. Remove them and try again.' }); return z.NEVER
})
const claimSchema = z.object({
  spent_on: date, category: z.enum(['material', 'labour', 'transport', 'fuel', 'equipment', 'subcontract', 'accommodation', 'food', 'maintenance', 'other'], { message: 'Choose a category' }),
  description: z.string().trim().min(1, 'Describe the expense').max(500),
  amount: z.coerce.number({ message: 'Enter the amount' }).positive('Amount must be greater than zero').max(1e9).transform(money2),
  vat_amount: z.coerce.number({ message: 'VAT must be a number' }).min(0, 'VAT cannot be negative').max(1e9).default(0).transform(money2),
  reference: z.string().max(120).optional(), supplier_name: z.string().max(200).optional(),
  supplier_trn: z.string().transform(s => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\d{15}$/, 'A UAE TRN has 15 digits')).optional(),
  quantity: z.coerce.number().positive('Quantity must be more than zero').max(1e7).optional(),
  paid_with: z.enum(['cash', 'card', 'bank_transfer', 'other']).default('cash'), card_id: z.string().uuid('Choose the card').optional(), project_id: z.string().uuid('Choose a project from the list').optional(),
  notes: z.string().max(2000).optional(), idempotency_key: z.string().uuid().optional(),
  items: jsonOf(z.array(line).max(200), []), source: z.enum(['manual', 'scan']).default('manual'),
  ocr_suggested: jsonOf(z.record(z.string(), z.unknown()).refine(o => JSON.stringify(o).length <= 20000, 'Scan data too large'), null as Record<string, unknown> | null),
  verified: z.string().optional(),
}).refine(v => v.vat_amount <= v.amount, { message: 'VAT looks larger than the amount. Enter the amount before VAT', path: ['vat_amount'] })
  .refine(v => v.source !== 'scan' || v.verified === 'on', { message: 'Tick “I checked these details against the receipt” before sending a scanned receipt', path: ['verified'] })
const KEYS = ['spent_on', 'category', 'description', 'amount', 'vat_amount', 'reference', 'supplier_name', 'supplier_trn', 'quantity', 'paid_with', 'card_id', 'project_id', 'notes', 'idempotency_key', 'items', 'source', 'ocr_suggested', 'verified']
type Claim = z.infer<typeof claimSchema>

const touch = () => { revalidatePath('/me'); revalidatePath('/me/expenses'); revalidatePath('/expenses') }
const parse = (fd: FormData) => claimSchema.safeParse(Object.fromEntries(KEYS.map(k => [k, str(fd, k)])))
const invalid = (e: z.ZodError): ActionState => ({ error: e.issues[0].message, fieldErrors: Object.fromEntries(e.issues.map(i => [i.path.join('.'), i.message])) })
const fields = (v: Claim) => ({
  spent_on: v.spent_on, category: v.category, description: v.description, amount: v.amount, vat_amount: v.vat_amount,
  reference: v.reference ?? null, supplier_name: v.supplier_name ?? null, supplier_trn: v.supplier_trn ?? null, quantity: v.quantity ?? null,
  paid_with: v.paid_with, card_id: v.paid_with === 'card' ? v.card_id ?? null : null, project_id: v.project_id ?? null, notes: v.notes ?? null, items: v.items,
})
/** Paid by card: which company card is required once the company has listed its cards (the database checks it again). */
async function cardProblem(c: Ctx, v: Claim): Promise<ActionState | null> {
  if (v.paid_with !== 'card') return null
  const cards = await companyCards(c)
  if (!cards.length) return null
  if (!v.card_id || !cards.some(k => k.id === v.card_id)) return { error: 'Choose which card you paid with.', fieldErrors: { card_id: 'Required for a card payment' } }
  return null
}

/** Reads and checks a receipt file (type from its bytes, size, active content) before anything is written. */
async function readReceipt(c: Ctx, fd: FormData): Promise<{ file: File; buf: Uint8Array; mime: string } | { error: string } | null> {
  const f = fd.get('file')
  if (!(f instanceof File) || f.size === 0) return null
  const buf = new Uint8Array(await f.arrayBuffer())
  const check = validateUpload({ name: f.name, size: f.size, type: f.type }, buf.slice(0, 16))
  if (!check.ok) return { error: `The receipt was not accepted: ${check.error}` }
  if (!/^(image\/|application\/pdf$)/.test(check.mime)) return { error: 'The receipt must be a photo (JPG, PNG, WEBP) or a PDF.' }
  const bad = scanUpload(buf, check.mime)
  if (bad) { await securityEvent('upload_rejected', { companyId: c.company.id, userId: c.userId, detail: `${f.name}: ${bad}` }); return { error: bad } }
  return { file: f, buf, mime: check.mime }
}

/** Stores a checked receipt as (a new version of) the claim's own document. Server-side only (service role). */
async function storeReceipt(c: Ctx, claimId: string, docId: string | null, r: { file: File; buf: Uint8Array; mime: string }, v: Claim, empName: string) {
  const admin = createAdminClient()
  let id = docId, versionNo = 1
  if (id) {
    const { data: last } = await admin.from('document_versions').select('version_no').eq('document_id', id).order('version_no', { ascending: false }).limit(1).maybeSingle()
    versionNo = (last?.version_no ?? 0) + 1
  } else {
    const { data: d, error } = await admin.from('documents').insert({
      company_id: c.company.id, owner_type: 'expense_claim', owner_id: claimId, folder: 'Expenses/Employee claims', reminders_active: false, created_by: c.userId,
      name: `Receipt: ${empName}, ${v.supplier_name ?? v.description}${v.reference ? ` ${v.reference}` : ''}`.slice(0, 250), reference_no: v.reference ?? null, issue_date: v.spent_on,
    }).select('id').single()
    if (error) throw error
    id = d.id
  }
  const path = storagePath(c.company.id, id!, versionNo, r.file.name)
  const up = await admin.storage.from('vault').upload(path, r.buf, { contentType: r.mime, upsert: false })
  if (up.error) { if (!docId) await admin.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', id!); throw new Error('The receipt could not be uploaded. Please try again.') }
  const { data: ver, error } = await admin.from('document_versions').insert({
    company_id: c.company.id, document_id: id, version_no: versionNo, storage_path: path, file_name: r.file.name, mime_type: r.mime, size_bytes: r.file.size, sha256: sha256Hex(r.buf), uploaded_by: c.userId,
  }).select('id').single()
  if (error) throw error
  await admin.from('documents').update({ current_version_id: ver.id }).eq('id', id!)
  await admin.from('document_access_logs').insert({ company_id: c.company.id, document_id: id, user_id: c.userId, action: versionNo > 1 ? 'replace' : 'upload' })
  return id!
}

/** The employee's own claim with the same receipt number (written any way: "AM-501" = "am 501"), not withdrawn or
 *  rejected: almost always the same receipt sent twice. */
/**
 * The same expense sent twice (withdrawn and rejected ones do not count): the same receipt number, or, for one sent without
 * a receipt number, the same day, supplier and amounts. The database refuses it too (0033); this gives the friendly message
 * before the receipt is uploaded.
 */
async function alreadyClaimed(c: Ctx, empId: string, v: Claim, exclude?: string): Promise<ActionState | null> {
  const ref = v.reference ? normRef(v.reference) : '', sup = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const { data } = await c.supabase.from('expense_claims').select('id,spent_on,reference,supplier_name,amount,vat_amount').eq('employee_id', empId).not('status', 'in', '(withdrawn,rejected)').limit(5000)
  const others = (data ?? []).filter(r => r.id !== exclude)
  const byRef = ref ? others.find(r => normRef(r.reference ?? '') === ref) : undefined
  if (byRef) return { error: `You already sent receipt ${byRef.reference} (${formatShortDate(byRef.spent_on)}). Open it under My expenses instead of sending it again.`, fieldErrors: { reference: 'Already sent' } }
  const same = ref ? undefined : others.find(r => r.spent_on === v.spent_on && Number(r.amount) === v.amount && Number(r.vat_amount) === v.vat_amount && sup(r.supplier_name) === sup(v.supplier_name ?? null))
  if (same) return { error: `You already sent this expense (${formatShortDate(same.spent_on)} · AED ${(Number(same.amount) + Number(same.vat_amount)).toFixed(2)}). Open it under My expenses instead of sending it again. If it is a different expense, add its receipt number.`, fieldErrors: { amount: 'Already sent' } }
  return null
}

/** The same receipt photo / PDF already attached to another of the employee's open or approved expenses. */
async function receiptUsed(c: Ctx, empId: string, buf: Uint8Array, exclude?: string): Promise<ActionState | null> {
  const { data: mine } = await c.supabase.from('expense_claims').select('id,receipt_document_id').eq('employee_id', empId).not('status', 'in', '(withdrawn,rejected)').not('receipt_document_id', 'is', null).limit(5000)
  const docs = (mine ?? []).filter(r => r.id !== exclude).map(r => r.receipt_document_id as string)
  if (!docs.length) return null
  // server side, limited to this employee's own receipts (their claims were read above under their own access)
  const { data: hit } = await createAdminClient().from('document_versions').select('id').eq('company_id', c.company.id).eq('sha256', sha256Hex(buf)).in('document_id', docs).limit(1)
  return hit?.length ? { error: 'This receipt is already attached to another of your expenses. Open that one under My expenses instead of sending it again.' } : null
}
/** The database's own refusal (0033 duplicate / project rules), shown as it is. */
const refusal = (e: { code?: string; message?: string }): ActionState | null =>
  e.code === 'P0001' && /already sent|current projects/.test(e.message ?? '') ? { error: e.message! } : null

export async function submitClaim(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const { c, emp } = await getMe()
    if (!emp) return { error: 'Your login is not linked to an employee record yet. Ask HR to link it.' }
    const r = parse(fd); if (!r.success) return invalid(r.error)
    const v = r.data
    if (v.spent_on > c.today) return { error: 'The expense date cannot be in the future.', fieldErrors: { spent_on: 'In the future' } }
    const cardErr = await cardProblem(c, v); if (cardErr) return cardErr
    if (v.idempotency_key) { const { data: dup } = await c.supabase.from('expense_claims').select('id').eq('idempotency_key', v.idempotency_key).maybeSingle(); if (dup) return { ok: true, message: 'Expense already sent for approval.' } }
    const twice = await alreadyClaimed(c, emp.id, v)
    if (twice) return twice
    const receipt = await readReceipt(c, fd)
    if (receipt && 'error' in receipt) return { error: receipt.error }
    const used = receipt ? await receiptUsed(c, emp.id, receipt.buf) : null
    if (used) return used

    const id = crypto.randomUUID()
    // the receipt is stored first (as this claim's document), so a claim never exists without the file the employee sent
    const docId = receipt ? await storeReceipt(c, id, null, receipt, v, emp.full_name) : null
    const { error } = await c.supabase.from('expense_claims').insert({
      id, company_id: c.company.id, employee_id: emp.id, ...fields(v), source: v.source, ocr_suggested: v.ocr_suggested, idempotency_key: v.idempotency_key ?? null,
    })
    if (error) {
      if (docId) await createAdminClient().from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', docId)
      if (error.code === '23505') return { ok: true, message: 'Expense already sent for approval.' }
      const r = refusal(error); if (r) return r
      throw error
    }
    if (docId) { const { error: le } = await createAdminClient().from('expense_claims').update({ receipt_document_id: docId }).eq('id', id); if (le) throw le }
    touch()
    return { ok: true, message: 'Sent for approval. You will be notified when it is decided.' }
  })
}

export async function updateClaim(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const { c, emp } = await getMe()
    if (!emp) return { error: 'Your login is not linked to an employee record.' }
    const { data: cur } = await c.supabase.from('expense_claims').select('id,status,receipt_document_id,employee_id').eq('id', id).maybeSingle()
    if (!cur || cur.employee_id !== emp.id) return { error: 'Expense not found.' }
    if (!['pending', 'correction_requested'].includes(cur.status)) return { error: 'This expense was already decided and can no longer be changed.' }
    const r = parse(fd); if (!r.success) return invalid(r.error)
    const v = r.data
    if (v.spent_on > c.today) return { error: 'The expense date cannot be in the future.', fieldErrors: { spent_on: 'In the future' } }
    const cardErr = await cardProblem(c, v); if (cardErr) return cardErr
    const twice = await alreadyClaimed(c, emp.id, v, id)
    if (twice) return twice
    const receipt = await readReceipt(c, fd)
    if (receipt && 'error' in receipt) return { error: receipt.error }
    const used = receipt ? await receiptUsed(c, emp.id, receipt.buf, id) : null
    if (used) return used
    const { data, error } = await c.supabase.from('expense_claims').update({ ...fields(v), status: 'pending' }).eq('id', id).in('status', ['pending', 'correction_requested']).select('id')
    if (error) { const r = refusal(error); if (r) return r; throw error }
    if (!data?.length) return { error: 'This expense was decided meanwhile and can no longer be changed.' }
    if (receipt) {
      const docId = await storeReceipt(c, id, cur.receipt_document_id, receipt, v, emp.full_name)
      if (!cur.receipt_document_id) await createAdminClient().from('expense_claims').update({ receipt_document_id: docId }).eq('id', id)
    }
    touch()
    return { ok: true, message: cur.status === 'correction_requested' ? 'Corrected and sent for approval again.' : 'Expense updated.' }
  })
}

export async function withdrawClaim(id: string): Promise<ActionState> {
  return safe(async () => {
    const { c, emp } = await getMe()
    if (!emp) return { error: 'Your login is not linked to an employee record.' }
    const { data, error } = await c.supabase.from('expense_claims').update({ status: 'withdrawn' }).eq('id', id).eq('employee_id', emp.id).in('status', ['pending', 'correction_requested']).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'This expense was already decided and can no longer be withdrawn.' }
    touch()
    return { ok: true, message: 'Expense withdrawn.' }
  })
}

/** Self check-in / check-out and overtime start / stop (server time, the company's date). Only when the company turned it on. */
const PUNCH: Record<string, string> = { in: 'Checked in.', out: 'Checked out.', ot_start: 'Overtime started.', ot_stop: 'Overtime stopped.' }
export async function punch(kind: 'in' | 'out' | 'ot_start' | 'ot_stop'): Promise<ActionState> {
  return safe(async () => {
    const { c, emp } = await getMe()
    if (!emp) return { error: 'Your login is not linked to an employee record.' }
    if (!(kind in PUNCH)) return { error: 'Unknown attendance action.' }
    const { error } = await c.supabase.rpc('attendance_punch', { p_kind: kind })
    if (error) return { error: error.message }
    revalidatePath('/me'); revalidatePath('/me/attendance')
    return { ok: true, message: PUNCH[kind] }
  })
}
