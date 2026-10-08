'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need, type Ctx } from '@/lib/auth'
import { safe } from '@/lib/action'
import { parseCsv } from '@/lib/csv'
import { readXlsx } from '@/lib/xlsx'
import { partySchema } from '@/lib/parties'
import type { ActionState } from '@/lib/utils'

const MAX = 2000
const key = (h: string) => h.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const ALIASES: Record<string, string> = { company: 'name', company_name: 'name', customer: 'name', customer_name: 'name', supplier: 'name', contact: 'contact_person', mobile: 'phone', tel: 'phone', telephone: 'phone', e_mail: 'email', vat_no: 'trn', trn_no: 'trn', tax_no: 'trn', price: 'rate', unit_price: 'rate', default_rate: 'rate', vat: 'vat_category', employee_id: 'employee_no', emp_no: 'employee_no', name_en: 'full_name', employee_name: 'full_name', joined: 'joining_date', joining: 'joining_date' }

/** Reads an uploaded .csv or .xlsx into objects keyed by normalised header names. */
async function readRows(fd: FormData): Promise<{ rows: Record<string, string>[] } | { error: string }> {
  const f = fd.get('file')
  if (!(f instanceof File) || !f.size) return { error: 'Choose a CSV or Excel (.xlsx) file.' }
  if (f.size > 5 * 1024 * 1024) return { error: 'The file is larger than 5 MB.' }
  let grid: string[][]
  try {
    const buf = new Uint8Array(await f.arrayBuffer())
    grid = /\.xlsx$/i.test(f.name) || (buf[0] === 0x50 && buf[1] === 0x4b) ? readXlsx(buf) : parseCsv(new TextDecoder().decode(buf))
  } catch { return { error: 'The file could not be read. Save it as CSV (UTF-8) or .xlsx and try again.' } }
  if (grid.length < 2) return { error: 'The file needs a header row and at least one data row.' }
  if (grid.length - 1 > MAX) return { error: `Import up to ${MAX} rows at a time (this file has ${grid.length - 1}).` }
  const head = grid[0].map(h => ALIASES[key(h)] ?? key(h))
  return { rows: grid.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]))) }
}
const summary = (ok: number, skipped: string[], bad: string[]) => {
  const parts = [`${ok} imported`]
  if (skipped.length) parts.push(`${skipped.length} skipped (already exist: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''})`)
  if (bad.length) parts.push(`${bad.length} rejected: ${bad.slice(0, 6).join(' · ')}${bad.length > 6 ? ' …' : ''}`)
  return parts.join('; ') + '.'
}
async function existingNames(c: Ctx, table: string, col = 'name') {
  const { data } = await c.supabase.from(table).select(col).limit(20000)
  return new Set((data ?? []).map((r: any) => String(r[col]).toLowerCase().trim()))
}

export async function importParties(kind: 'customers' | 'suppliers', _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const table = z.enum(['customers', 'suppliers']).parse(kind)
    const r = await readRows(fd); if ('error' in r) return r
    if (!('name' in r.rows[0])) return { error: 'A “name” column is required (first row = column names).' }
    const have = await existingNames(c, table), skipped: string[] = [], bad: string[] = [], ok: Record<string, unknown>[] = []
    r.rows.forEach((row, i) => {
      const v = partySchema.safeParse(Object.fromEntries(Object.entries(row).filter(([k, x]) => x && ['name', 'contact_person', 'phone', 'whatsapp', 'email', 'trn', 'address', 'notes', 'credit_days'].includes(k))))
      if (!v.success) { bad.push(`row ${i + 2}: ${v.error.issues[0].message}`); return }
      const n = v.data.name.toLowerCase().trim()
      if (have.has(n)) { skipped.push(v.data.name); return }
      have.add(n); ok.push({ ...v.data, ...(table === 'suppliers' ? { credit_days: undefined } : { created_by: c.userId }), company_id: c.company.id })
    })
    for (let i = 0; i < ok.length; i += 500) { const { error } = await c.supabase.from(table).insert(ok.slice(i, i + 500)); if (error) throw error }
    revalidatePath('/parties')
    return { ok: true, message: summary(ok.length, skipped, bad) }
  })
}

export async function importCatalog(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const r = await readRows(fd); if ('error' in r) return r
    if (!('name' in r.rows[0])) return { error: 'A “name” column is required.' }
    const have = await existingNames(c, 'catalog_items'), skipped: string[] = [], bad: string[] = [], ok: Record<string, unknown>[] = []
    const vat = (s?: string) => { const t = (s ?? '').toLowerCase(); return !t || /standard|5/.test(t) ? 'standard' : /zero|0%/.test(t) ? 'zero' : /exempt/.test(t) ? 'exempt' : /out|no/.test(t) ? 'out_of_scope' : null }
    r.rows.forEach((row, i) => {
      const name = row.name?.slice(0, 200), rate = row.rate ? Number(row.rate.replace(/[^\d.]/g, '')) : 0, v = vat(row.vat_category)
      if (!name) { bad.push(`row ${i + 2}: name is empty`); return }
      if (!Number.isFinite(rate) || rate < 0) { bad.push(`row ${i + 2}: invalid rate`); return }
      if (!v) { bad.push(`row ${i + 2}: VAT must be standard / zero / exempt / out of scope`); return }
      if (have.has(name.toLowerCase())) { skipped.push(name); return }
      have.add(name.toLowerCase())
      ok.push({ company_id: c.company.id, name, description: row.description?.slice(0, 2000) || null, unit: (row.unit || 'Nos').slice(0, 20), rate: Math.round(rate * 100) / 100, vat_category: v, category: row.category?.slice(0, 80) || null, notes: row.notes?.slice(0, 1000) || null, created_by: c.userId })
    })
    for (let i = 0; i < ok.length; i += 500) { const { error } = await c.supabase.from('catalog_items').insert(ok.slice(i, i + 500)); if (error) throw error }
    revalidatePath('/catalog')
    return { ok: true, message: summary(ok.length, skipped, bad) }
  })
}

export async function importEmployees(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'employees.view_sensitive')
    const r = await readRows(fd); if ('error' in r) return r
    if (!('employee_no' in r.rows[0]) || !('full_name' in r.rows[0])) return { error: 'Columns “employee_no” and “full_name” are required.' }
    const have = await existingNames(c, 'employees', 'employee_no'), skipped: string[] = [], bad: string[] = [], ok: Record<string, unknown>[] = []
    const date = (s?: string) => (!s ? null : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(s) ? s.split(/[./-]/).reverse().map(x => x.padStart(2, '0')).join('-') : /^\d{5}$/.test(s) ? new Date(Date.UTC(1899, 11, 30 + Number(s))).toISOString().slice(0, 10) : 'bad')
    r.rows.forEach((row, i) => {
      const no = row.employee_no?.slice(0, 40), name = row.full_name?.slice(0, 200), joined = date(row.joining_date)
      if (!no || !name || name.length < 2) { bad.push(`row ${i + 2}: employee_no and full_name are required`); return }
      if (joined === 'bad') { bad.push(`row ${i + 2}: joining_date must be YYYY-MM-DD or DD/MM/YYYY`); return }
      if (have.has(no.toLowerCase())) { skipped.push(no); return }
      have.add(no.toLowerCase())
      ok.push({ company_id: c.company.id, employee_no: no, full_name: name, nationality: row.nationality || null, department: row.department || null, designation: row.designation || null, phone: row.phone || null, joining_date: joined, work_location: row.work_location || null })
    })
    for (let i = 0; i < ok.length; i += 500) { const { error } = await c.supabase.from('employees').insert(ok.slice(i, i + 500)); if (error) throw error }
    revalidatePath('/employees')
    return { ok: true, message: summary(ok.length, skipped, bad) }
  })
}
