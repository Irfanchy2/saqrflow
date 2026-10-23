'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const uuid = z.string().uuid()
const qty = (msg: string) => z.coerce.number({ message: msg }).max(1e9).transform(n => Math.round(n * 1000) / 1000)
const money = z.coerce.number({ message: 'Cost must be a number' }).min(0, 'Cost cannot be negative').max(1e10).transform(n => Math.round(n * 10000) / 10000)
const fieldErrors = (e: z.ZodError) => Object.fromEntries(e.issues.map(i => [i.path.join('.'), i.message]))
const done = () => { revalidatePath('/stock'); revalidatePath('/') }

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200), sku: z.string().trim().max(40).optional(),
  category: z.string().trim().max(80).optional(), unit: z.string().trim().min(1).max(20).default('Nos'), location: z.string().trim().max(80).optional(),
  reorder_level: qty('Reorder level must be a number').pipe(z.number().min(0, 'Reorder level cannot be negative')).default(0),
  reorder_qty: qty('Reorder quantity must be a number').pipe(z.number().min(0, 'Reorder quantity cannot be negative')).default(0),
  supplier_id: uuid.optional(), notes: z.string().max(1000).optional(),
})
const ITEM_KEYS = ['name', 'sku', 'category', 'unit', 'location', 'reorder_level', 'reorder_qty', 'supplier_id', 'notes']

/** Adds or edits a stock item. A new item can start with an opening quantity (recorded as its first movement). */
export async function saveStockItem(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const r = itemSchema.safeParse(Object.fromEntries(ITEM_KEYS.map(k => [k, str(fd, k)])))
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: fieldErrors(r.error) }
    const v = r.data, row = { ...v, sku: v.sku ?? null, category: v.category ?? null, location: v.location ?? null, supplier_id: v.supplier_id ?? null, notes: v.notes ?? null, updated_at: new Date().toISOString() }
    let opening: { qty: number; cost: number } | null = null
    if (!id && str(fd, 'opening_qty')) {
      const o = z.object({ qty: qty('Opening quantity must be a number').pipe(z.number().positive('Opening quantity must be more than zero')), cost: money.default(0) })
        .safeParse({ qty: str(fd, 'opening_qty'), cost: str(fd, 'opening_cost') })
      if (!o.success) return { error: o.error.issues[0].message, fieldErrors: { opening_qty: o.error.issues[0].message } }
      opening = o.data
    }
    const res = id ? await c.supabase.from('stock_items').update(row).eq('id', id).select('id').single()
      : await c.supabase.from('stock_items').insert({ ...row, company_id: c.company.id, created_by: c.userId }).select('id').single()
    if (res.error) {
      if (res.error.code === '23505') return /sku/.test(res.error.message) ? { error: `Code “${v.sku}” is already used by another item.`, fieldErrors: { sku: 'Already used' } } : { error: `“${v.name}” is already in stock.`, fieldErrors: { name: 'Already exists' } }
      throw res.error
    }
    if (opening) {
      const { error } = await c.supabase.from('stock_movements').insert({ company_id: c.company.id, item_id: res.data.id, kind: 'opening', qty: opening.qty, unit_cost: opening.cost, moved_on: c.today, notes: 'Opening stock', created_by: c.userId })
      if (error) throw error
    }
    done(); return { ok: true, message: id ? 'Item updated.' : opening ? `Item added with ${opening.qty} ${v.unit} in stock.` : 'Item added.' }
  })
}

export async function setStockItemActive(id: string, active: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { error } = await c.supabase.from('stock_items').update({ active, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error
    done(); return { ok: true, message: active ? 'Item restored.' : 'Item archived. Its history is kept.' }
  })
}

const moveSchema = z.object({
  item_id: uuid, kind: z.enum(['receipt', 'issue', 'return', 'adjustment']), qty: qty('Enter the quantity'),
  unit_cost: money.optional(), moved_on: date, supplier_id: uuid.optional(), supplier_name: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(120).optional(), project_id: uuid.optional(), work_order_id: uuid.optional(),
  notes: z.string().max(1000).optional(), idempotency_key: uuid.optional(),
})
const MOVE_KEYS = ['item_id', 'kind', 'qty', 'unit_cost', 'moved_on', 'supplier_id', 'supplier_name', 'reference', 'project_id', 'work_order_id', 'notes', 'idempotency_key']

/**
 * Receive (in), issue to a job (out), return from a job (in) or adjust after a count (either way).
 * The quantity is entered as a positive number; the sign comes from the kind (an adjustment picks a direction).
 */
export async function recordStockMovement(fixedItem: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const raw = Object.fromEntries(MOVE_KEYS.map(k => [k, str(fd, k)]))
    if (fixedItem) raw.item_id = fixedItem
    const r = moveSchema.safeParse({ ...raw, moved_on: raw.moved_on ?? c.today })
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: fieldErrors(r.error) }
    const v = r.data
    if (v.qty <= 0) return { error: 'Enter a quantity greater than zero.', fieldErrors: { qty: 'More than zero' } }
    if (v.moved_on > c.today) return { error: 'The date cannot be in the future.', fieldErrors: { moved_on: 'In the future' } }
    if (v.kind === 'adjustment' && !v.notes) return { error: 'Say why the count changed (e.g. damaged, stock take).', fieldErrors: { notes: 'Required for an adjustment' } }
    const sign = v.kind === 'issue' || (v.kind === 'adjustment' && str(fd, 'direction') === 'out') ? -1 : 1
    if (v.idempotency_key) { const { data: dup } = await c.supabase.from('stock_movements').select('id').eq('idempotency_key', v.idempotency_key).maybeSingle(); if (dup) return { ok: true, message: 'Already recorded.' } }
    let supplierName = v.supplier_name ?? null
    if (v.supplier_id && !supplierName) supplierName = (await c.supabase.from('suppliers').select('name').eq('id', v.supplier_id).maybeSingle()).data?.name ?? null
    const { data, error } = await c.supabase.from('stock_movements').insert({
      company_id: c.company.id, item_id: v.item_id, kind: v.kind, qty: sign * v.qty,
      unit_cost: sign < 0 ? null : v.unit_cost ?? null,   // stock out is costed at the average by the database
      moved_on: v.moved_on, supplier_id: v.supplier_id ?? null, supplier_name: supplierName, reference: v.reference ?? null,
      project_id: v.project_id ?? null, work_order_id: v.work_order_id ?? null, notes: v.notes ?? null, idempotency_key: v.idempotency_key ?? null, created_by: c.userId,
    }).select('balance_after, stock_items(name, unit)').single()
    if (error) {
      if (error.code === '23505') return { ok: true, message: 'Already recorded.' }
      if (/not enough stock/.test(error.message)) return { error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + '.', fieldErrors: { qty: 'More than on hand' } }
      throw error
    }
    const it = (data as any).stock_items, word = { receipt: 'Received', issue: 'Issued', return: 'Returned', adjustment: 'Adjusted' }[v.kind]
    if (v.project_id) revalidatePath(`/projects/${v.project_id}`)
    done(); return { ok: true, message: `${word} ${v.qty} ${it?.unit ?? ''}. ${it?.name ?? 'Item'} now has ${Number(data.balance_after)} on hand.` }
  })
}
