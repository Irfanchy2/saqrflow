'use server'
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'
import { buildTallyXml, checkExport, checkTallyXml, vouchersFor, CATEGORY_LABELS, METHOD_LABELS, TALLY_VERSIONS } from '@/lib/expenses/tally'
import { loadExportRows, loadTallySettings, readFilters } from '@/lib/expenses/export-data'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ledger = z.string().trim().max(200).optional().transform(s => s || undefined)
const done = () => { revalidatePath('/expenses') }

/** Marks older expenses (saved before verification existed) as checked, so they can be exported. Never touches exported ones. */
export async function markVerified(ids: string[]): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'finance.view')
    const list = ids.filter(i => UUID.test(i)).slice(0, 5000)
    if (!list.length) return { error: 'Choose the expenses you checked.' }
    const { data, error } = await c.supabase.from('project_expenses').update({ verified_at: new Date().toISOString(), verified_by: c.userId })
      .in('id', list).is('verified_at', null).is('export_batch_id', null).select('id')
    if (error) throw error
    done(); return { ok: true, message: `${data?.length ?? 0} expense${data?.length === 1 ? '' : 's'} marked as checked.` }
  })
}

/** Ledger mapping: which Tally ledger each category, payment method and account posts to, and the input VAT ledger. */
export async function saveTallySettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'finance.view'); need(c, 'data.export')
    const v = z.object({ tally_company: ledger, tally_version: z.enum(TALLY_VERSIONS), paid_mode: z.enum(['payment', 'purchase_and_payment']), vat_ledger: ledger })
      .parse({ tally_company: str(fd, 'tally_company'), tally_version: str(fd, 'tally_version') ?? 'TallyPrime', paid_mode: str(fd, 'paid_mode') ?? 'payment', vat_ledger: str(fd, 'vat_ledger') })
    const pick = (prefix: string, keys: string[]) => Object.fromEntries(keys.map(k => [k, ledger.parse(str(fd, `${prefix}${k}`))]).filter(([, x]) => x))
    const banks = [...fd.keys()].filter(k => k.startsWith('bank_')).map(k => k.slice(5)).filter(k => UUID.test(k))
    const prev = await loadTallySettings(c)
    const row = {
      company_id: c.company.id, tally_company: v.tally_company ?? null, tally_version: v.tally_version, paid_mode: v.paid_mode, vat_ledger: v.vat_ledger ?? null,
      category_ledgers: pick('cat_', Object.keys(CATEGORY_LABELS)), payment_ledgers: pick('pay_', Object.keys(METHOD_LABELS).filter(k => k !== 'credit')), bank_ledgers: pick('bank_', banks),
      updated_at: new Date().toISOString(), updated_by: c.userId,
      // a different Tally version has not been tested yet
      ...(prev.validated_version && prev.validated_version !== v.tally_version ? { validated_version: null, validated_at: null, validated_by: null } : {}),
    }
    const { error } = await c.supabase.from('expense_tally_settings').upsert(row)
    if (error) throw error
    done(); return { ok: true, message: 'Ledger mapping saved.' }
  })
}

/** After a successful test import in Tally, record which version it was checked with. Until then the app never calls the file "compatible". */
export async function setTallyValidated(on: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'finance.view'); need(c, 'data.export')
    const s = await loadTallySettings(c)
    const { error } = await c.supabase.from('expense_tally_settings').upsert({ company_id: c.company.id, tally_version: s.tally_version,
      validated_version: on ? s.tally_version : null, validated_at: on ? new Date().toISOString() : null, validated_by: on ? c.userId : null })
    if (error) throw error
    done(); return { ok: true, message: on ? `Recorded: a test import into ${s.tally_version} worked.` : 'Test import record cleared.' }
  })
}

/** A supplier's Tally ledger name (and TRN). */
export async function saveSupplierLedger(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = z.object({ tally_ledger: ledger, trn: z.string().transform(s => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\d{15}$/, 'A UAE TRN has 15 digits')).optional() })
      .safeParse({ tally_ledger: str(fd, 'tally_ledger'), trn: str(fd, 'trn') })
    if (!v.success) return { error: v.error.issues[0].message, fieldErrors: Object.fromEntries(v.error.issues.map(i => [i.path.join('.'), i.message])) }
    const { error } = await c.supabase.from('suppliers').update({ tally_ledger: v.data.tally_ledger ?? null, ...(v.data.trn ? { trn: v.data.trn } : {}) }).eq('id', id)
    if (error) throw error
    done(); return { ok: true, message: 'Supplier saved.' }
  })
}

/**
 * Creates a Tally export: checks every expense and mapping, builds the XML, checks its structure, then (in one database
 * transaction) gives it a reference, stores the exact file and marks the expenses as exported so they cannot go twice.
 */
export async function createTallyExport(filters: Record<string, string | undefined>): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'finance.view'); need(c, 'data.export')
    const f = { ...readFilters(filters), status: 'ready' as const }
    const [rows, s] = await Promise.all([loadExportRows(c, f), loadTallySettings(c)])
    const rep = checkExport(rows, s)
    if (!rep.ready.length) return { error: rep.excluded.length ? `Nothing to export: ${rep.excluded.length} expense${rep.excluded.length === 1 ? ' is' : 's are'} not verified, waiting for approval or already exported.` : 'No expenses match these filters.' }
    if (rep.errors.length) return { error: `Fix ${rep.errors.length} problem${rep.errors.length === 1 ? '' : 's'} first: ${rep.errors.map(e => e.message).join('; ')}.` }
    const xml = buildTallyXml(rep.ready, s), chk = checkTallyXml(xml)
    if (!chk.ok) return { error: `The file failed its own check, so it was not created: ${chk.errors.slice(0, 3).join('; ')}` }
    const expected = Math.round(rep.ready.flatMap(e => vouchersFor(e, s)).flatMap(v => v.lines).reduce((t, l) => t + (l.dr > 0 ? l.dr : 0), 0) * 100) / 100
    if (Math.abs(chk.debit - expected) > 0.01) return { error: 'The file does not add up to the expenses selected, so it was not created. Please report this.' }
    const { data, error } = await c.supabase.rpc('expense_export_create', {
      p_ids: rep.ready.map(e => e.id), p_tally_version: s.tally_version, p_filters: f, p_content: xml,
      p_checksum: createHash('sha256').update(xml).digest('hex'), p_total: rep.totals.total, p_vat: rep.totals.vat,
    })
    if (error) return { error: error.message }
    const b = (data as { batch_id: string; batch_ref: string }[])[0]
    done(); return { ok: true, message: `Export ${b.batch_ref} created: ${rep.totals.count} expense${rep.totals.count === 1 ? '' : 's'}, AED ${rep.totals.total.toFixed(2)}.`, data: { id: b.batch_id, ref: b.batch_ref } }
  })
}

/** Undo an export (with a reason): its expenses are unlocked and can be corrected and exported again. */
export async function releaseTallyExport(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'finance.view'); need(c, 'data.export'); need(c, 'records.edit')
    const { data, error } = await c.supabase.rpc('expense_export_release', { p_id: id, p_reason: str(fd, 'reason') ?? '' })
    if (error) return { error: error.message, fieldErrors: /why/i.test(error.message) ? { reason: error.message } : undefined }
    done(); return { ok: true, message: `Export undone. ${data} expense${data === 1 ? '' : 's'} unlocked. If it was already imported, delete those vouchers in Tally (or re-import: the same voucher ids update them).` }
  })
}
