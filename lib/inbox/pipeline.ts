import 'server-only'
import type { Ctx } from '../auth'
import { typeDef } from './catalog'
import { extractText } from './text'
import { ocrImage, OCR_ENGINE } from './ocr'
import { mergeReadings, validateExtraction } from './validate'
import { rulesExtract, RULES_VERSION, type Extraction } from './rules'
import { claudeAvailable, claudeExtract } from './claude'
import { companyScore, matchByName, matchEmployee, normId, type EmployeeCandidate } from './match'
import { decide, type DuplicateCandidate } from './decide'

export async function aiEnabled(c: Ctx) {
  const { data } = await c.supabase.from('app_settings').select('value').eq('key', 'ai.ocr_provider').maybeSingle()
  return data?.value === 'claude' && claudeAvailable()
}

/** Run OCR/classification/matching for one inbox item and store the result. Never files anything by itself. */
export async function processInboxItem(c: Ctx, item: { id: string; sha256: string; mime_type: string }, buf: Uint8Array) {
  try {
    const warnings: string[] = []
    let text = await extractText(buf, item.mime_type)
    let ocrUsed = false
    // photos / scans: read the text on this server first (private, free); the AI reader can still improve on it
    if (!text.trim() && item.mime_type.startsWith('image/')) {
      const o = await ocrImage(buf, item.mime_type)
      if (o.text.trim()) { text = o.text; ocrUsed = true; if (o.confidence < 0.6) warnings.push('The image is hard to read (low OCR quality) — a sharper photo or scan gives better results') }
    }
    const local: Extraction = rulesExtract(text)
    if (ocrUsed) { local.engineVersion = `${RULES_VERSION}+${OCR_ENGINE}`; for (const f of Object.values(local.fields)) if (f) f.confidence = Math.min(f.confidence, 0.85) }
    let x: Extraction = local
    if (await aiEnabled(c)) {
      try {
        const ai = await claudeExtract(buf, item.mime_type, text)
        if (text.trim()) { const m = mergeReadings(ai, local); x = m.merged; warnings.push(...m.warnings) } else x = ai
      } catch (e) { warnings.push(`AI reader unavailable (${(e as Error).message}); used local reading instead`) }
    }
    warnings.push(...validateExtraction(x, c.today))
    const def = typeDef(x.docType)

    // matching
    let employees: ReturnType<typeof matchEmployee> = [], customers: ReturnType<typeof matchByName> = []
    if (def?.owner === 'employee' || !def) {
      const [{ data: emps }, { data: ids }] = await Promise.all([
        c.supabase.from('employees').select('id,full_name,employee_no,phone').neq('status', 'archived').limit(2000),
        c.supabase.from('documents').select('owner_id,reference_no').eq('owner_type', 'employee').not('reference_no', 'is', null).is('deleted_at', null).limit(5000),
      ])
      const cands: EmployeeCandidate[] = (emps ?? []).map(e => ({ ...e, idNumbers: (ids ?? []).filter(d => d.owner_id === e.id).map(d => d.reference_no as string) }))
      employees = matchEmployee({ holderName: x.fields.holder_name?.value, documentNumber: x.fields.document_number?.value, text }, cands)
    }
    if (def?.owner === 'customer') {
      const { data } = await c.supabase.from('customers').select('id,name').limit(2000)
      customers = matchByName(x.fields.customer_name?.value, data ?? [])
    }
    const companyMatch = x.fields.company_name ? companyScore(x.fields.company_name.value, [c.company.name]) : 0

    // duplicates & renewals
    const duplicates: DuplicateCandidate[] = []
    const { data: sameFile } = await c.supabase.from('document_versions').select('document_id, documents!document_versions_document_id_fkey(name,expiry_date,owner_id)').eq('sha256', item.sha256).limit(3)
    for (const v of (sameFile ?? []) as any[]) duplicates.push({ documentId: v.document_id, name: v.documents?.name ?? 'Existing document', kind: 'same_file', expiry: v.documents?.expiry_date ?? null, ownerId: v.documents?.owner_id ?? null })
    const docNo = x.fields.document_number?.value
    if (def) {
      let q = c.supabase.from('documents').select('id,name,reference_no,expiry_date,owner_id,owner_type,category:document_categories(name)').is('deleted_at', null).limit(200)
      const ownerId = def.owner === 'employee' && employees[0]?.confidence >= 0.85 ? employees[0].id : null
      q = ownerId ? q.eq('owner_type', 'employee').eq('owner_id', ownerId) : q.eq('owner_type', def.owner === 'employee' ? 'employee' : def.owner === 'customer' ? 'vault' : 'company')
      const { data: existing } = await q
      const newExp = x.fields.expiry_date?.value
      for (const d of (existing ?? []) as any[]) {
        if (duplicates.some(k => k.documentId === d.id)) continue
        const sameNo = docNo && d.reference_no && normId(d.reference_no) === normId(docNo)
        const sameCat = d.category?.name === def.category
        if (!sameNo && !(sameCat && def.owner !== 'customer' && (def.owner !== 'employee' || ownerId))) continue
        const renewal = !!(newExp && d.expiry_date && newExp > d.expiry_date)
        if (sameNo && !renewal) duplicates.push({ documentId: d.id, name: d.name, kind: 'same_number', expiry: d.expiry_date, ownerId: d.owner_id })
        else if (renewal || (sameCat && !sameNo)) duplicates.push({ documentId: d.id, name: d.name, kind: 'renewal', expiry: d.expiry_date, ownerId: d.owner_id })
      }
    }

    const decision = decide(x, { companyName: c.company.name, companyMatch, employees, customers, duplicates, hasText: text.trim().length > 20 || x.engine === 'claude' })
    decision.suggestion.warnings.push(...warnings)
    await c.supabase.from('document_extractions').insert({
      company_id: c.company.id, inbox_id: item.id, engine: x.engine, engine_version: x.engineVersion, doc_type: x.docType,
      doc_type_confidence: x.docTypeConfidence, fields: x.fields, text_excerpt: text.slice(0, 20000) || null,
    })
    await c.supabase.from('document_inbox').update({
      status: decision.status, doc_type: x.docType, confidence: decision.confidence, review_reasons: decision.reasons,
      suggestion: decision.suggestion, processed_at: new Date().toISOString(), error: null,
    }).eq('id', item.id)
    return decision
  } catch (e) {
    await c.supabase.from('document_inbox').update({ status: 'failed', error: (e as Error).message.slice(0, 500), processed_at: new Date().toISOString() }).eq('id', item.id)
    return null
  }
}

/** Run async tasks with a concurrency limit. */
export async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<unknown>) {
  const queue = [...items]; await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => { while (queue.length) await fn(queue.shift()!) }))
}
