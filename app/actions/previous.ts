'use server'
import { revalidatePath } from 'next/cache'
import { getCtx, need, type Ctx } from '@/lib/auth'
import { demoGuard } from '@/lib/demo'
import { safe, str } from '@/lib/action'
import { parseCsv } from '@/lib/csv'
import { readXlsx } from '@/lib/xlsx'
import { fmtMoney } from '@/lib/sales/money'
import { salesSettings } from '@/lib/sales/data'
import { PAID_BEFORE, PREVIOUS, insertPreviousInvoice, previousProblems, previousSchema, previousTotals } from '@/lib/sales/previous'
import { PREVIOUS_COLUMNS, customerKey, detectColumns, readPreviousRow, type PrevRow } from '@/lib/sales/previous-import'
import type { ActionState } from '@/lib/utils'

const CUST = 'id,name,address,trn,phone,email,contact_person'
const done = () => { revalidatePath('/invoices', 'layout'); revalidatePath('/parties', 'layout'); revalidatePath('/') }

/** One previous invoice, typed in with its original number (no automatic numbering). */
export async function addPreviousInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'finance.view'); demoGuard(c, 'adding previous invoices')
    const raw = Object.fromEntries(['customer_id', 'number', 'issue_date', 'due_date', 'lpo_ref', 'description', 'amount', 'amount_is', 'vat_rate', 'paid', 'paid_on'].map(k => [k, str(fd, k) || undefined]))
    const p = previousSchema.safeParse(raw)
    if (!p.success) return { error: p.error.issues[0].message, fieldErrors: Object.fromEntries(p.error.issues.map(i => [i.path.join('.'), i.message])) }
    const problem = previousProblems(p.data, c.today); if (problem) return { error: `${problem}.` }
    const { data: cu } = await c.supabase.from('customers').select(CUST).eq('id', p.data.customer_id).maybeSingle()
    if (!cu) return { error: 'Customer not found.' }
    const r = await insertPreviousInvoice(c, p.data, cu)
    if ('error' in r) return { error: r.error, fieldErrors: { number: 'Already used' } }
    done()
    const t = previousTotals(p.data.amount, p.data.amount_is, p.data.vat_rate), bal = t.total - p.data.paid
    return { ok: true, message: `Saved ${p.data.number} for ${cu.name}: AED ${fmtMoney(t.total)}${bal > 0.004 ? `, AED ${fmtMoney(bal)} unpaid` : ', fully paid'}. You can add the next one.`, data: { id: r.id } }
  })
}

async function readFile(fd: FormData): Promise<string[][] | { error: string }> {
  const f = fd.get('file')
  if (!(f instanceof File) || !f.size) return { error: 'Choose your Excel (.xlsx) or CSV file.' }
  if (f.size > 5 * 1024 * 1024) return { error: 'The file is larger than 5 MB. Split it into smaller files.' }
  try {
    const buf = new Uint8Array(await f.arrayBuffer())
    const grid = (/\.xlsx$/i.test(f.name) || (buf[0] === 0x50 && buf[1] === 0x4b) ? readXlsx(buf) : parseCsv(new TextDecoder().decode(buf).replace(/^﻿/, '')))
      .map(r => r.map(x => String(x ?? '').trim())).filter(r => r.some(Boolean))
    if (grid.length < 2) return { error: 'The file needs a header row (column names) and at least one invoice row.' }
    if (grid.length - 1 > 1000) return { error: 'Upload up to 1,000 invoices at a time. Split the file.' }
    return grid
  } catch { return { error: 'The file could not be read. Save it as .xlsx or CSV (UTF-8) and try again.' } }
}

async function allRows<T>(c: Ctx, q: (from: number) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = []
  for (let from = 0; ; from += 1000) { const { data } = await q(from); out.push(...(data ?? [])); if (!data || data.length < 1000) break }
  return out
}

/**
 * Excel / CSV of previous invoices. `mode=check`: reads every row and reports what would be saved and what is wrong,
 * saving nothing. `mode=import`: saves the good rows (same checks; numbers already used are skipped, never changed).
 */
export async function uploadPreviousInvoices(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'finance.view'); demoGuard(c, 'importing previous invoices')
    const grid = await readFile(fd); if ('error' in grid) return grid
    const cols = detectColumns(grid[0])
    const missing = PREVIOUS_COLUMNS.filter(f => 'required' in f && f.required && cols[f.key] < 0).map(f => f.label)
    if (missing.length) return { error: `These columns were not found in the first row: ${missing.join(', ')}. Use the template, or rename your column headings.`, data: { headers: grid[0] } }
    const [customers, numbers] = await Promise.all([
      allRows<{ id: string; name: string }>(c, from => c.supabase.from('customers').select('id,name').range(from, from + 999)),
      allRows<{ number: string }>(c, from => c.supabase.from('invoices').select('number').eq('doc_type', 'invoice').range(from, from + 999)),
    ])
    const byName = new Map(customers.map(x => [customerKey(x.name), x.id])), used = new Set(numbers.map(n => n.number.toLowerCase()))
    const ready: (PrevRow & { customer_id: string })[] = [], problems: { line: number; error: string }[] = [], dupes: { line: number; number: string }[] = []
    const seen = new Set<string>()
    grid.slice(1).forEach((row, i) => {
      const r = readPreviousRow(row, cols, i + 2)
      if ('error' in r) { problems.push(r); return }
      const cid = byName.get(customerKey(r.customer))
      if (!cid) { problems.push({ line: r.line, error: `Customer “${r.customer}” is not in Averiqo. Add it under Customers first (same spelling).` }); return }
      const k = r.number.toLowerCase()
      if (used.has(k) || seen.has(k)) { dupes.push({ line: r.line, number: r.number }); return }
      if (r.issue_date > c.today) { problems.push({ line: r.line, error: 'The invoice date is in the future' }); return }
      seen.add(k); ready.push({ ...r, customer_id: cid })
    })
    const found = PREVIOUS_COLUMNS.filter(f => cols[f.key] >= 0).map(f => `${f.label} ← “${grid[0][cols[f.key]]}”`)
    const unpaid = ready.reduce((s, r) => s + Math.max(0, r.amount - r.paid), 0)
    const summary = { total: grid.length - 1, ready: ready.length, unpaid: Math.round(unpaid * 100) / 100, columns: found, problems: problems.slice(0, 50), problemCount: problems.length, dupes: dupes.slice(0, 30), dupeCount: dupes.length }
    if (str(fd, 'mode') !== 'import') return { ok: true, data: { mode: 'check', ...summary } }
    if (!ready.length) return { error: 'Nothing to save: every row is already in Averiqo or has a problem.', data: { mode: 'check', ...summary } }
    const full = new Map((await allRows<any>(c, from => c.supabase.from('customers').select(CUST).in('id', [...new Set(ready.map(r => r.customer_id))].slice(0, 1000)).range(from, from + 999))).map(x => [x.id, x]))
    const dueDays = (await salesSettings(c)).dueDays, upload = crypto.randomUUID().slice(0, 8)
    let saved = 0
    for (const r of ready) {
      const res = await insertPreviousInvoice(c, { customer_id: r.customer_id, number: r.number, issue_date: r.issue_date, due_date: r.due_date, lpo_ref: r.lpo_ref, description: r.description, amount: r.amount, amount_is: 'total', vat_rate: r.vat_rate, paid: r.paid },
        full.get(r.customer_id), { dueDays, externalId: `${upload}:${r.line}` })
      if ('error' in res) problems.push({ line: r.line, error: res.error }); else saved++
    }
    done()
    return { ok: true, message: `${saved} previous invoice${saved === 1 ? '' : 's'} saved.`, data: { mode: 'import', saved, ...summary, problems: problems.slice(0, 50), problemCount: problems.length } }
  })
}

/** Removes a previous invoice entered by mistake (with the "paid before" amount entered with it). Not for invoices with later payments. */
export async function removePreviousInvoice(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'records.delete')
    const { data: inv } = await c.supabase.from('invoices').select('id,number,external_provider').eq('id', id).maybeSingle()
    if (!inv || inv.external_provider !== PREVIOUS) return { error: 'Only a previous invoice entered from your records can be removed here.' }
    const { data: pays } = await c.supabase.from('payments').select('id,reference').eq('invoice_id', id)
    if ((pays ?? []).some(p => p.reference !== PAID_BEFORE)) return { error: 'This invoice has payments recorded in Averiqo. Remove those payments first (or use Mark as unpaid).' }
    if (pays?.length) { const { error } = await c.supabase.from('payments').delete().in('id', pays.map(p => p.id)); if (error) throw error }
    // the number is freed (renamed in the Trash copy) so the invoice can be entered again correctly with the same number
    const { error: ue } = await c.supabase.from('invoices').update({ status: 'cancelled', number: `${inv.number} (removed ${id.slice(0, 6)})` }).eq('id', id); if (ue) throw ue
    const { error: de } = await c.supabase.rpc('soft_delete', { p_entity: 'invoice', p_id: id }); if (de) throw de
    done()
    return { ok: true, message: `${inv.number} removed (it is in the Trash).` }
  })
}
