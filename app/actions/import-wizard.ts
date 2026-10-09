'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need, type Ctx } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { parseCsv } from '@/lib/csv'
import { readXlsx } from '@/lib/xlsx'
import { partySchema } from '@/lib/parties'
import { IMPORT_ENTITIES, MAX_ROWS, parseAmount, parseDate, parseSource, parseVat, type EntitySpec } from '@/lib/import-spec'
import type { ActionState } from '@/lib/utils'

type Grid = string[][]
async function readGrid(fd: FormData): Promise<{ grid: Grid; name: string } | { error: string }> {
  const f = fd.get('file')
  if (!(f instanceof File) || !f.size) return { error: 'Choose a CSV or Excel (.xlsx) file.' }
  if (f.size > 5 * 1024 * 1024) return { error: 'The file is larger than 5 MB. Split it into smaller files.' }
  let grid: Grid
  try {
    const buf = new Uint8Array(await f.arrayBuffer())
    grid = /\.xlsx$/i.test(f.name) || (buf[0] === 0x50 && buf[1] === 0x4b) ? readXlsx(buf) : parseCsv(new TextDecoder().decode(buf).replace(/^﻿/, ''))
  } catch { return { error: 'The file could not be read. Save it as .xlsx or CSV (UTF-8) and try again. (.xls files: open in Excel and “Save as” .xlsx.)' } }
  grid = grid.filter(r => r.some(c => String(c ?? '').trim()))
  if (grid.length < 2) return { error: 'The file needs a header row (column names) and at least one data row.' }
  if (grid.length - 1 > MAX_ROWS) return { error: `Import up to ${MAX_ROWS.toLocaleString('en-US')} rows at a time (this file has ${(grid.length - 1).toLocaleString('en-US')}).` }
  return { grid: grid.map(r => r.map(c => String(c ?? '').trim())), name: f.name.slice(0, 200) }
}

function specFor(c: Ctx, entity: string): EntitySpec | { error: string } {
  const spec = IMPORT_ENTITIES[entity]; if (!spec) return { error: 'Choose what you are importing.' }
  need(c, spec.perm); if (spec.sensitive) need(c, 'employees.view_sensitive')
  return spec
}

/** Step 1 → 2: column names, a few sample rows, the row count and a guessed mapping. Nothing is saved. */
export async function previewImport(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); const entity = str(fd, 'entity') ?? ''
    const spec = specFor(c, entity); if ('error' in spec) return spec
    const r = await readGrid(fd); if ('error' in r) return r
    const { guessMapping } = await import('@/lib/import-spec')
    const headers = r.grid[0].map((h, i) => h || `Column ${i + 1}`)
    return { ok: true, data: { entity, file: r.name, headers, sample: r.grid.slice(1, 6), total: r.grid.length - 1, mapping: guessMapping(entity, headers) } }
  })
}

type Built = { rows: Record<string, unknown>[]; dupes: string[]; errors: { row: number; message: string }[] }

async function existing(c: Ctx, table: string, col: string) {
  const out = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await c.supabase.from(table).select(col).range(from, from + 999)
    for (const r of (data ?? []) as any[]) out.add(String(r[col] ?? '').toLowerCase().trim())
    if (!data || data.length < 1000) break
  }
  return out
}

/** Validates every mapped row exactly as the normal forms do, and finds duplicates (in the file and already saved). */
async function build(c: Ctx, entity: string, spec: EntitySpec, grid: Grid, mapping: Record<string, number>): Promise<Built> {
  const table = entity, have = await existing(c, table, spec.dupe), seen = new Set<string>()
  const out: Built = { rows: [], dupes: [], errors: [] }
  const get = (row: string[], k: string) => { const i = mapping[k]; return i !== undefined && i >= 0 ? (row[i] ?? '').trim() : '' }
  grid.slice(1).forEach((row, n) => {
    const line = n + 2, v: Record<string, string> = {}
    for (const f of spec.fields) { const x = get(row, f.key); if (x) v[f.key] = x }
    const fail = (m: string) => { out.errors.push({ row: line, message: m }) }
    let rec: Record<string, unknown> | null = null
    if (entity === 'customers' || entity === 'suppliers') {
      const p = partySchema.safeParse(entity === 'suppliers' ? { ...v, credit_days: undefined } : v)
      if (!p.success) return fail(p.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
      rec = { ...p.data, ...(entity === 'customers' ? { created_by: c.userId } : {}) }
    } else if (entity === 'catalog_items') {
      if (!v.name) return fail('Item name is empty')
      const rate = parseAmount(v.rate), vat = parseVat(v.vat_category)
      if (Number.isNaN(rate) || (rate !== null && rate < 0)) return fail(`Rate “${v.rate}” is not a number`)
      if (!vat) return fail(`VAT “${v.vat_category}” must be standard, zero, exempt or out of scope`)
      rec = { name: v.name.slice(0, 200), description: v.description?.slice(0, 2000) || null, unit: (v.unit || 'Nos').slice(0, 20), rate: rate ?? 0, vat_category: vat, category: v.category?.slice(0, 80) || null, notes: v.notes?.slice(0, 1000) || null, created_by: c.userId }
    } else if (entity === 'employees') {
      if (!v.employee_no || !v.full_name || v.full_name.length < 2) return fail('Employee ID and full name are required')
      const joined = parseDate(v.joining_date); if (joined === 'bad') return fail(`Joining date “${v.joining_date}” must be YYYY-MM-DD or DD/MM/YYYY`)
      rec = { employee_no: v.employee_no.slice(0, 40), full_name: v.full_name.slice(0, 200), nationality: v.nationality?.slice(0, 80) || null, department: v.department?.slice(0, 120) || null, designation: v.designation?.slice(0, 120) || null, phone: v.phone?.slice(0, 40) || null, joining_date: joined, work_location: v.work_location?.slice(0, 200) || null }
    } else if (entity === 'leads') {
      if (!v.company_name) return fail('Company / client is empty')
      if (v.phone && !/^[+\d][\d\s()-]{5,}$/.test(v.phone)) return fail(`Phone “${v.phone}” is not valid`)
      if (v.email && !z.string().email().safeParse(v.email).success) return fail(`Email “${v.email}” is not valid`)
      const value = parseAmount(v.estimated_value); if (Number.isNaN(value) || (value !== null && value < 0)) return fail(`Estimated value “${v.estimated_value}” is not a number`)
      rec = { company_name: v.company_name.slice(0, 200), contact_person: v.contact_person?.slice(0, 120) || null, phone: v.phone?.slice(0, 40) || null, email: v.email?.slice(0, 200) || null, location: v.location?.slice(0, 300) || null,
        service: v.service?.slice(0, 300) || null, source: parseSource(v.source), estimated_value: value, notes: v.notes?.slice(0, 4000) || null, salesperson_id: c.userId, created_by: c.userId }
    }
    if (!rec) return
    const key = String(rec[spec.dupe] ?? '').toLowerCase().trim()
    if (have.has(key) || seen.has(key)) { out.dupes.push(String(rec[spec.dupe])); return }
    seen.add(key); out.rows.push(rec)
  })
  return out
}

function readMapping(fd: FormData, spec: EntitySpec): Record<string, number> | { error: string } {
  let m: Record<string, number>
  try { m = z.record(z.string(), z.number().int().min(-1).max(500)).parse(JSON.parse(String(fd.get('mapping') ?? '{}'))) } catch { return { error: 'The column mapping is not valid. Start again.' } }
  const missing = spec.fields.filter(f => f.required && !(m[f.key] >= 0)).map(f => f.label)
  if (missing.length) return { error: `Choose the column for: ${missing.join(', ')}.` }
  const used = Object.values(m).filter(i => i >= 0); if (new Set(used).size !== used.length) return { error: 'The same column is mapped to two fields.' }
  return m
}

/** Step 3: `mode=check` validates only; `mode=import` saves the valid rows as one batch that can be undone. */
export async function runImport(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); const entity = str(fd, 'entity') ?? ''
    const spec = specFor(c, entity); if ('error' in spec) return spec
    const mapping = readMapping(fd, spec); if ('error' in mapping) return mapping
    const r = await readGrid(fd); if ('error' in r) return r
    const b = await build(c, entity, spec, r.grid, mapping)
    const summary = { total: r.grid.length - 1, ready: b.rows.length, dupes: b.dupes.slice(0, 30), dupeCount: b.dupes.length, errors: b.errors.slice(0, 50), errorCount: b.errors.length }
    if (str(fd, 'mode') !== 'import') return { ok: true, data: { mode: 'check', ...summary } }
    if (!b.rows.length) return { error: 'Nothing to import: every row is a duplicate or has an error.' }
    if (entity === 'leads' && b.rows.length > 500) return { error: 'Import up to 500 leads at a time (each gets its own lead number). Split the file.' }
    const { data: batch, error } = await c.supabase.from('import_batches').insert({ company_id: c.company.id, entity, file_name: r.name, total: summary.total, mapping, created_by: c.userId }).select('id').single()
    if (error) throw error
    const rows: Record<string, unknown>[] = b.rows.map(x => ({ ...x, company_id: c.company.id, import_batch_id: batch.id }))
    if (entity === 'leads') {   // lead numbers come from the shared numbering (unique, in order)
      for (const row of rows) { const { data: no, error: e } = await c.supabase.rpc('next_document_number', { p_doc_type: 'lead' }); if (e) throw e; row.number = no }
    }
    let imported = 0
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await c.supabase.from(entity).insert(rows.slice(i, i + 500))
      if (e) { await c.supabase.from('import_batches').update({ imported, skipped: summary.dupeCount, failed: summary.errorCount + rows.length - imported }).eq('id', batch.id); throw e }
      imported += Math.min(500, rows.length - i)
    }
    await c.supabase.from('import_batches').update({ imported, skipped: summary.dupeCount, failed: summary.errorCount }).eq('id', batch.id)
    revalidatePath(spec.list.split('?')[0]); revalidatePath('/import')
    return { ok: true, message: `${imported} ${spec.noun} imported.`, data: { mode: 'import', batch: batch.id, imported, list: spec.list, ...summary } }
  })
}

/** Moves every record of a batch to the Trash (restorable); products are switched to inactive instead. */
export async function undoImport(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Unknown import.' }
    const { data: b } = await c.supabase.from('import_batches').select('id,entity,undone_at').eq('id', id).maybeSingle()
    if (!b) return { error: 'Unknown import.' }
    if (b.undone_at) return { error: 'This import was already undone.' }
    const spec = IMPORT_ENTITIES[b.entity]
    let n = 0
    if (!spec.trash) {
      const { data, error } = await c.supabase.from(b.entity).update({ active: false }).eq('import_batch_id', id).select('id'); if (error) throw error; n = data?.length ?? 0
    } else {
      need(c, 'records.delete')
      const { data: ids } = await c.supabase.from(b.entity).select('id').eq('import_batch_id', id).limit(MAX_ROWS)
      const list = (ids ?? []).map(x => x.id)
      for (let i = 0; i < list.length; i += 20) {
        const res = await Promise.all(list.slice(i, i + 20).map(rid => c.supabase.rpc('soft_delete', { p_entity: spec.trash, p_id: rid })))
        n += res.filter(x => !x.error).length
      }
      if (list.length && !n) return { error: 'These records could not be moved to the Trash (they may already be in use, e.g. on invoices).' }
    }
    await c.supabase.from('import_batches').update({ undone_at: new Date().toISOString(), undone_by: c.userId }).eq('id', id)
    revalidatePath(spec.list.split('?')[0]); revalidatePath('/import')
    return { ok: true, message: spec.trash ? `${n} record(s) moved to the Trash (restore them from there if needed).` : `${n} item(s) switched to inactive.` }
  })
}
