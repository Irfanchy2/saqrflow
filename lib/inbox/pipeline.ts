import 'server-only'
import type { Ctx } from '../auth'
import { typeDef } from './catalog'
import { extractText } from './text'
import { rulesExtract, RULES_VERSION, type Extraction } from './rules'
import { companyScore, matchByName, matchEmployee, normId, type EmployeeCandidate, type Match } from './match'
import { decide, type DuplicateCandidate } from './decide'
import { mergeReadings, validateExtraction } from './validate'
import { isOcrMode, ocrProviders, providerOrder, runOcr, type OcrMode, type OcrProviderId } from '../ai/ocr'
import { aiProviders, isAiMode, pickAi, AiError, type AiMode } from '../ai/llm'
import { redactForAi } from '../ai/redact'

export interface AiSettings { ocr: OcrMode; ai: AiMode; redact: boolean }
/** Company choice (Settings → AI & Automation), falling back to OCR_PROVIDER / AI_PROVIDER env, then AUTO. */
export async function aiSettings(c: Ctx): Promise<AiSettings> {
  const { data } = await c.supabase.from('app_settings').select('key,value').in('key', ['ocr.provider', 'ai.provider', 'ai.ocr_provider', 'ai.redact_ids'])
  const m = Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
  const envOcr = process.env.OCR_PROVIDER, envAi = process.env.AI_PROVIDER
  const ai: AiMode = isAiMode(m['ai.provider']) ? m['ai.provider'] : m['ai.ocr_provider'] === 'claude' ? 'claude' : m['ai.ocr_provider'] === 'rules' ? 'rules' : isAiMode(envAi) ? envAi : 'auto'
  return { ocr: isOcrMode(m['ocr.provider']) ? m['ocr.provider'] : isOcrMode(envOcr) ? envOcr : 'auto', ai, redact: m['ai.redact_ids'] !== false }
}
/** Is any AI classifier active for this company? (used for the inbox banner) */
export async function aiEnabled(c: Ctx) {
  const s = await aiSettings(c)
  if (s.ai === 'rules') return false
  const p = await aiProviders(c.company.id)
  return !!pickAi(s.ai, p, true)
}

const log = (c: Ctx, table: 'ocr_logs' | 'ai_processing_logs', row: Record<string, unknown>) =>
  c.supabase.from(table).insert({ company_id: c.company.id, created_by: c.userId, ...row }).then(({ error }) => { if (error) console.warn(`[${table}]`, error.message) })

export interface ProcessOptions { ocr?: OcrMode; force?: boolean }

/**
 * Upload → OCR → AI classification → metadata → entity matching → confidence → suggestion.
 * Never files anything; the original stays in private storage whatever happens.
 */
export async function processInboxItem(c: Ctx, item: { id: string; sha256: string; mime_type: string; file_name?: string }, buf: Uint8Array, opts: ProcessOptions = {}) {
  const t0 = Date.now()
  const setStatus = (status: string, extra: Record<string, unknown> = {}) => c.supabase.from('document_inbox').update({ status, ...extra }).eq('id', item.id)
  try {
    const settings = await aiSettings(c)
    const ocrMode = opts.ocr ?? settings.ocr
    await setStatus('processing', { error: null })
    const warnings: string[] = [], reasons: string[] = []

    // ── 1. text: cache → PDF text layer → OCR providers ──
    let text = '', ocrProvider: OcrProviderId | 'cache' | null = null, ocrLang: string | null = null, ocrMs = 0
    let cachedAi: Extraction | null = null
    if (!opts.force) {
      const { data: prev } = await c.supabase.from('document_inbox').select('id').eq('sha256', item.sha256).neq('id', item.id).not('processed_at', 'is', null).order('processed_at', { ascending: false }).limit(5)
      if (prev?.length) {
        const { data: px } = await c.supabase.from('document_extractions').select('engine,engine_version,doc_type,doc_type_confidence,fields,text_excerpt,ocr_provider,ocr_language').in('inbox_id', prev.map(p => p.id)).not('text_excerpt', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (px?.text_excerpt) {
          text = px.text_excerpt; ocrProvider = 'cache'; ocrLang = px.ocr_language
          await log(c, 'ocr_logs', { inbox_id: item.id, provider: px.ocr_provider ?? 'text_layer', ok: true, chars: text.length, cached: true, language: ocrLang })
          if (px.engine !== 'rules') cachedAi = { engine: px.engine, engineVersion: px.engine_version, docType: px.doc_type, docTypeConfidence: Number(px.doc_type_confidence), fields: px.fields, alternatives: [] }
        }
      }
    }
    if (!text && item.mime_type === 'application/pdf') {
      const s = Date.now(), layer = await extractText(buf, item.mime_type)
      if (layer.replace(/\s/g, '').length >= 50) {
        text = layer; ocrProvider = 'text_layer'; ocrMs = Date.now() - s
        await log(c, 'ocr_logs', { inbox_id: item.id, provider: 'text_layer', ok: true, chars: text.length, processing_ms: ocrMs })
      }
    }
    if (!text) {
      const providers = providerOrder(ocrMode, await ocrProviders(c.company.id), item.mime_type)
      const { result, attempts } = await runOcr({ bytes: buf, mime: item.mime_type, name: item.file_name ?? 'document' }, providers)
      for (const a of attempts) await log(c, 'ocr_logs', { inbox_id: item.id, provider: a.provider, ok: a.ok, chars: a.chars, pages: a.pages, language: a.language, processing_ms: a.ms, error: a.error })
      if (result) {
        text = result.text; ocrProvider = result.provider; ocrLang = result.language; ocrMs = result.ms
        const failed = attempts.filter(a => !a.ok)
        if (failed.length) warnings.push(`Read with ${label(result.provider)} after ${failed.map(f => `${label(f.provider)} failed (${f.error})`).join('; ')}`)
      } else if (attempts.length) {
        reasons.push(`OCR failed: ${attempts.map(a => `${label(a.provider)}: ${a.error}`).join('; ')}`)
      } else {
        reasons.push(ocrMode === 'auto' ? 'No readable text found. No OCR service is configured for this file type. Add OCR.Space or Google Vision in Settings → AI & Automation, or enter the details manually'
          : `${label(ocrMode)} is not configured or cannot read this file type`)
      }
    }
    await setStatus('ocr_complete', { ocr_provider: ocrProvider })

    // ── 2. classification: local rules always; AI on top when configured ──
    const local: Extraction = rulesExtract(text)
    if (ocrProvider && !['text_layer', 'cache'].includes(ocrProvider)) {
      local.engineVersion = `${RULES_VERSION}+${ocrProvider === 'tesseract' ? 'tesseract-5-eng' : ocrProvider}`
      for (const f of Object.values(local.fields)) if (f) f.confidence = Math.min(f.confidence, ocrProvider === 'tesseract' ? 0.85 : 0.9)
    }
    let x: Extraction = local, aiProviderId = 'rules', aiMs = 0
    const p = settings.ai === 'rules' ? null : pickAi(settings.ai, await aiProviders(c.company.id), !!text.trim())
    if (cachedAi && p && cachedAi.engine === p.id) {
      const m = mergeReadings(cachedAi, local); x = m.merged; warnings.push(...m.warnings); aiProviderId = p.id
      await log(c, 'ai_processing_logs', { inbox_id: item.id, provider: p.id, model: cachedAi.engineVersion, purpose: 'classify', ok: true, cached: true })
    } else if (p) {
      const minimised = settings.redact && p.id === 'gemini' ? redactForAi(text) : { text, redacted: false }
      const s = Date.now()
      try {
        const r = await p.classifyDocument({ text: minimised.text, file: p.id === 'claude' ? { bytes: buf, mime: item.mime_type } : null })
        aiMs = r.ms; aiProviderId = p.id
        await log(c, 'ai_processing_logs', { inbox_id: item.id, provider: p.id, model: r.model, purpose: 'classify', ok: true, input_chars: minimised.text.length, redacted: minimised.redacted, processing_ms: r.ms })
        warnings.push(...r.warnings)
        if (text.trim()) { const m = mergeReadings(r.extraction, local); x = m.merged; warnings.push(...m.warnings) } else x = r.extraction
        if (r.requiresReview) reasons.push(`${p.label} flagged this document for manual review`)
      } catch (e) {
        const err = e instanceof AiError ? e : new AiError((e as Error).message, 'provider', p.id)
        await log(c, 'ai_processing_logs', { inbox_id: item.id, provider: p.id, model: p.model, purpose: 'classify', ok: false, input_chars: minimised.text.length, redacted: minimised.redacted, processing_ms: Date.now() - s, error: err.message.slice(0, 300) })
        reasons.push(`AI classification failed (${err.message}). Local rules were used; please check every field`)
      }
    }
    warnings.push(...validateExtraction(x, c.today))
    await setStatus('classification_complete', { ai_provider: aiProviderId })
    const def = typeDef(x.docType)

    // ── 3. entity matching (local only: no employee / customer lists leave the server) ──
    let employees: Match[] = [], customers: Match[] = [], suppliers: Match[] = [], projects: Match[] = [], vehicles: Match[] = []
    if (def?.owner === 'employee' || !def) {
      const [{ data: emps }, { data: ids }] = await Promise.all([
        c.supabase.from('employees').select('id,full_name,employee_no,phone').neq('status', 'archived').limit(2000),
        c.supabase.from('documents').select('owner_id,reference_no').eq('owner_type', 'employee').not('reference_no', 'is', null).is('deleted_at', null).limit(5000),
      ])
      const cands: EmployeeCandidate[] = (emps ?? []).map(e => ({ ...e, idNumbers: (ids ?? []).filter(d => d.owner_id === e.id).map(d => d.reference_no as string) }))
      employees = matchEmployee({ holderName: x.fields.holder_name?.value, documentNumber: x.fields.document_number?.value, text }, cands)
      const empNo = x.fields.employee_id?.value
      if (empNo) {
        const e = (emps ?? []).find(e => normId(e.employee_no) === normId(empNo))
        if (e && !employees.some(m => m.id === e.id && m.confidence >= 0.92)) employees = [{ id: e.id, name: e.full_name, confidence: 0.92, reason: `Employee ID ${e.employee_no} on the document` }, ...employees.filter(m => m.id !== e.id)]
      }
    }
    const byTrn = (rows: { id: string; name: string; trn?: string | null }[], name: string | undefined): Match[] => {
      const trn = x.fields.trn?.value
      const viaTrn = trn ? rows.filter(r => r.trn && normId(r.trn) === normId(trn)).map(r => ({ id: r.id, name: r.name, confidence: 0.98, reason: 'TRN matches' })) : []
      return [...viaTrn, ...matchByName(name, rows).filter(m => !viaTrn.some(v => v.id === m.id))]
    }
    if (def?.owner === 'customer') {
      const { data } = await c.supabase.from('customers').select('id,name,trn').limit(2000)
      customers = byTrn(data ?? [], x.fields.customer_name?.value)
    }
    if (def?.owner === 'supplier') {
      const { data } = await c.supabase.from('suppliers').select('id,name,trn').limit(2000)
      suppliers = byTrn(data ?? [], x.fields.supplier_name?.value ?? x.fields.company_name?.value)
    }
    if (def?.owner === 'project' || def?.owner === 'customer') {
      const { data } = await c.supabase.from('projects').select('id,name,code').neq('status', 'cancelled').limit(1000)
      const T = text.toUpperCase(), po = x.fields.po_number?.value
      projects = (data ?? []).map(pr => {
        let conf = 0, reason = ''
        if (pr.code && pr.code.length >= 3 && T.includes(pr.code.toUpperCase())) { conf = 0.95; reason = `Project code ${pr.code} on the document` }
        const n = Math.max(x.fields.project_name ? companyScore(x.fields.project_name.value, [pr.name]) : 0, pr.name.length >= 6 && T.includes(pr.name.toUpperCase()) ? 0.9 : 0)
        if (n > conf) { conf = n; reason = 'Project name matches' }
        return { id: pr.id, name: pr.name, confidence: conf, reason }
      }).filter(m => m.confidence >= 0.5).sort((a, b) => b.confidence - a.confidence).slice(0, 5)
      if (po) {
        const { data: inv } = await c.supabase.from('invoices').select('project_id, project:projects(name)').eq('lpo_ref', po).not('project_id', 'is', null).limit(1).maybeSingle()
        if (inv?.project_id && !projects.some(m => m.id === inv.project_id)) projects.unshift({ id: inv.project_id, name: (inv as any).project?.name ?? 'Project', confidence: 0.9, reason: `PO ${po} is linked to this project` })
      }
    }
    if (def?.owner === 'vehicle' && x.fields.plate_number) {
      const { data } = await c.supabase.from('assets').select('id,name,plate_or_serial').eq('kind', 'vehicle').limit(1000)
      const plate = normId(x.fields.plate_number.value)
      vehicles = (data ?? []).filter(v => v.plate_or_serial && plate.length >= 4 && normId(v.plate_or_serial).endsWith(plate.slice(-5)))
        .map(v => ({ id: v.id, name: `${v.name} (${v.plate_or_serial})`, confidence: normId(v.plate_or_serial!) === plate ? 0.97 : 0.85, reason: 'Plate number matches' }))
    }
    const companyMatch = x.fields.company_name ? companyScore(x.fields.company_name.value, [c.company.name]) : 0

    // ── 4. duplicates & renewals ──
    const duplicates: DuplicateCandidate[] = []
    const { data: sameFile } = await c.supabase.from('document_versions').select('document_id, documents!document_versions_document_id_fkey(name,expiry_date,owner_id)').eq('sha256', item.sha256).limit(3)
    for (const v of (sameFile ?? []) as any[]) duplicates.push({ documentId: v.document_id, name: v.documents?.name ?? 'Existing document', kind: 'same_file', expiry: v.documents?.expiry_date ?? null, ownerId: v.documents?.owner_id ?? null })
    const docNo = x.fields.document_number?.value
    if (def) {
      let q = c.supabase.from('documents').select('id,name,reference_no,expiry_date,issue_date,owner_id,owner_type,category:document_categories(name)').is('deleted_at', null).neq('status', 'archived').limit(200)
      const ownerId = def.owner === 'employee' && employees[0]?.confidence >= 0.85 ? employees[0].id : null
      q = ownerId ? q.eq('owner_type', 'employee').eq('owner_id', ownerId)
        : q.in('owner_type', def.owner === 'employee' ? ['employee'] : ['customer', 'supplier'].includes(def.owner) ? ['vault'] : def.owner === 'project' ? ['project'] : def.owner === 'vehicle' ? ['asset', 'company'] : ['company'])
      const { data: existing } = await q
      const newExp = x.fields.expiry_date?.value
      for (const d of (existing ?? []) as any[]) {
        if (duplicates.some(k => k.documentId === d.id)) continue
        const sameNo = docNo && d.reference_no && normId(d.reference_no) === normId(docNo)
        const sameCat = d.category?.name === def.category
        if (!sameNo && !(sameCat && !['customer', 'supplier', 'project', 'vehicle'].includes(def.owner) && (def.owner !== 'employee' || ownerId))) continue
        const renewal = !!(newExp && d.expiry_date && newExp > d.expiry_date)
        if (sameNo && !renewal) duplicates.push({ documentId: d.id, name: d.name, kind: 'same_number', expiry: d.expiry_date, ownerId: d.owner_id })
        else if (renewal || (sameCat && !sameNo)) duplicates.push({ documentId: d.id, name: d.name, kind: 'renewal', expiry: d.expiry_date, ownerId: d.owner_id })
      }
    }

    // ── 5. decision + confidence band ──
    const decision = decide(x, { companyName: c.company.name, companyMatch, employees, customers, suppliers, projects, vehicles, duplicates, hasText: text.trim().length > 20 || x.engine === 'claude' })
    decision.suggestion.warnings.push(...warnings)
    for (const r of reasons) if (!decision.reasons.includes(r)) decision.reasons.push(r)
    if (reasons.some(r => r.startsWith('No readable text') || r.startsWith('OCR failed'))) decision.reasons = decision.reasons.filter(r => !r.startsWith('No readable text found. Upload'))
    if (decision.confidence < 0.7 && def && !decision.reasons.some(r => /confidence/i.test(r))) decision.reasons.push(`Overall confidence ${Math.round(decision.confidence * 100)}%. Manual review required`)
    const ocrFailed = !text.trim() && x.engine !== 'claude' && reasons.some(r => r.startsWith('OCR failed'))
    const status = ocrFailed ? 'failed' : decision.reasons.length && decision.status === 'ready' ? 'needs_review' : decision.status
    const sug = decision.suggestion as any
    sug.projectCandidates = projects
    if (def?.owner === 'customer' && projects[0]?.confidence >= 0.85) sug.project = projects[0]
    sug.ocrProvider = ocrProvider; sug.aiProvider = aiProviderId

    await c.supabase.from('document_extractions').insert({
      company_id: c.company.id, inbox_id: item.id, engine: x.engine, engine_version: x.engineVersion, doc_type: x.docType,
      doc_type_confidence: x.docTypeConfidence, fields: x.fields, text_excerpt: text.slice(0, 20000) || null,
      ocr_provider: ocrProvider, ocr_language: ocrLang, ocr_ms: ocrMs || null, ai_ms: aiMs || null,
    })
    const { data: cur } = await c.supabase.from('document_inbox').select('attempts').eq('id', item.id).maybeSingle()
    await c.supabase.from('document_inbox').update({
      status, doc_type: x.docType, confidence: decision.confidence, review_reasons: decision.reasons, suggestion: decision.suggestion,
      processed_at: new Date().toISOString(), error: ocrFailed ? (decision.reasons.find(r => r.startsWith('OCR failed')) ?? 'OCR failed').slice(0, 500) : null,
      processing_ms: Date.now() - t0, attempts: (cur?.attempts ?? 0) + 1,
    }).eq('id', item.id)
    return { ...decision, status }
  } catch (e) {
    await c.supabase.from('document_inbox').update({ status: 'failed', error: (e as Error).message.slice(0, 500), processed_at: new Date().toISOString(), processing_ms: Date.now() - t0 }).eq('id', item.id)
    return null
  }
}

const LABELS: Record<string, string> = { ocrspace: 'OCR.Space', google_vision: 'Google Vision', tesseract: 'local OCR', text_layer: 'PDF text', auto: 'Auto' }
const label = (p: string) => LABELS[p] ?? p

/** Run async tasks with a concurrency limit. */
export async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<unknown>) {
  const queue = [...items]; await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => { while (queue.length) await fn(queue.shift()!) }))
}
