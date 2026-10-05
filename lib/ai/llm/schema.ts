// Strict structured output for document classification + server-side validation (AI output is never trusted as-is).
import { z } from 'zod'
import { DOC_TYPES, UNKNOWN_TYPE, typeDef, type FieldKey } from '../../inbox/catalog'
import { allDates } from '../../inbox/rules'
import type { Extraction, Fields } from '../../inbox/rules'

export const DOC_TYPE_KEYS = [UNKNOWN_TYPE, ...DOC_TYPES.map(d => d.key)] as [string, ...string[]]
export const CATEGORIES = ['company_document', 'employee_document', 'finance_document', 'project_document', 'vehicle_document', 'other'] as const
export const OWNER_TYPES = ['company', 'employee', 'customer', 'supplier', 'project', 'vehicle', 'unknown'] as const
export const EXTRA_KEYS = ['date_of_birth', 'nationality', 'employer', 'profession', 'license_type', 'trn', 'landlord', 'tenant', 'property', 'amount',
  'customer_name', 'plate_number', 'supplier_name', 'project_name', 'po_number', 'employee_id'] as const satisfies readonly FieldKey[]

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nullable = z.string().trim().max(300).nullable()

/** What the model must return (mirrors the JSON contract in the spec). */
export const AiDocumentSchema = z.object({
  document_type: z.string(),
  category: z.string(),
  document_owner_type: z.string(),
  company_name: nullable, employee_name: nullable, document_number: nullable,
  issue_date: z.string().nullable(), expiry_date: z.string().nullable(), issuing_authority: nullable,
  confidence: z.number(),
  fields: z.array(z.object({ key: z.string(), value: z.string().nullable(), confidence: z.number() })).max(40),
  requires_manual_review: z.boolean(),
})
export type AiDocument = z.infer<typeof AiDocumentSchema>

/** Same contract as a JSON schema (OpenAPI subset) for Gemini's responseSchema. */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    document_type: { type: 'STRING', enum: DOC_TYPE_KEYS },
    category: { type: 'STRING', enum: [...CATEGORIES] },
    document_owner_type: { type: 'STRING', enum: [...OWNER_TYPES] },
    company_name: { type: 'STRING', nullable: true }, employee_name: { type: 'STRING', nullable: true }, document_number: { type: 'STRING', nullable: true },
    issue_date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' }, expiry_date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
    issuing_authority: { type: 'STRING', nullable: true },
    confidence: { type: 'NUMBER' },
    fields: { type: 'ARRAY', items: { type: 'OBJECT', properties: { key: { type: 'STRING', enum: [...EXTRA_KEYS] }, value: { type: 'STRING', nullable: true }, confidence: { type: 'NUMBER' } }, required: ['key', 'value', 'confidence'] } },
    requires_manual_review: { type: 'BOOLEAN' },
  },
  required: ['document_type', 'category', 'document_owner_type', 'company_name', 'employee_name', 'document_number', 'issue_date', 'expiry_date', 'issuing_authority', 'confidence', 'fields', 'requires_manual_review'],
} as const

export const SYSTEM_PROMPT = `You classify UAE business, government, HR, finance, project and vehicle documents from OCR text and return strict JSON.
Rules:
- NEVER invent information. Only return a value that is literally present in the text; otherwise return null.
- Never guess expiry dates, passport numbers, Emirates ID numbers, licence numbers, names, company names, amounts or document numbers.
- Dates must be YYYY-MM-DD. UAE numeric dates are day-first (05/03/2027 = 2027-03-05).
- Text such as [REDACTED-ID] was removed for privacy: do not reconstruct it; return null for that value.
- confidence (0..1) = how sure you are about the document type AND the key values. Use < 0.7 when the text is partial, blurry or ambiguous.
- Set requires_manual_review = true when anything important is uncertain or missing (e.g. an expiring document with no expiry date).
- document_type must be one of the allowed keys; use "unknown" if it does not clearly match.
Allowed document types: ${DOC_TYPES.map(d => `${d.key} (${d.label})`).join(', ')}.`

const normText = (s: string) => s.toUpperCase().replace(/[^A-Z0-9؀-ۿ]/g, '')
const presentIn = (value: string, text: string) => {
  const v = normText(value), t = normText(text)
  if (!v) return false
  if (t.includes(v)) return true
  const words = value.toUpperCase().split(/[^A-Z0-9؀-ۿ]+/).filter(w => w.length >= 3)
  return words.length > 0 && words.filter(w => t.includes(w)).length / words.length >= 0.75   // tolerate OCR spacing / punctuation
}

/**
 * Parse + validate the model's JSON and cross-check every value against the OCR text.
 * Values that are not in the document are dropped (and reported) — the model cannot introduce data.
 */
export function validateAiOutput(raw: unknown, ocrText: string, engine: Extraction['engine'], model: string): { extraction: Extraction; warnings: string[]; requiresReview: boolean } {
  const parsed = AiDocumentSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw)
  if (!parsed.success) throw new Error(`AI returned an invalid structure (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message})`)
  const a = parsed.data, warnings: string[] = []
  const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))
  const docType = DOC_TYPE_KEYS.includes(a.document_type) ? a.document_type : UNKNOWN_TYPE
  if (docType !== a.document_type) warnings.push(`AI suggested an unsupported type “${a.document_type}”`)
  const conf = clamp(a.confidence)
  const textDates = new Set(allDates(ocrText).map(d => d.iso))
  const fields: Fields = {}
  const put = (k: FieldKey, v: string | null | undefined, c: number) => {
    if (v == null || !String(v).trim() || /REDACTED/i.test(v)) return
    let value = String(v).trim()
    if (k.endsWith('_date')) {
      if (!iso.safeParse(value).success || Number.isNaN(Date.parse(value))) { warnings.push(`AI returned an invalid ${k.replace('_', ' ')} (“${value}”) — ignored`); return }
      if (textDates.size && !textDates.has(value)) { warnings.push(`AI ${k.replace('_', ' ')} ${value} does not appear in the document — ignored`); return }
    } else if (!presentIn(value, ocrText)) {
      warnings.push(`AI value for ${k.replace(/_/g, ' ')} (“${value.slice(0, 40)}”) was not found in the document text — ignored`); return
    }
    if (k === 'amount') value = value.replace(/[^0-9.]/g, '')
    fields[k] = { value, confidence: clamp(c), source: 'ai' }
  }
  put('company_name', a.company_name, conf); put('holder_name', a.employee_name, conf); put('document_number', a.document_number, conf)
  put('issue_date', a.issue_date, conf); put('expiry_date', a.expiry_date, conf); put('issuing_authority', a.issuing_authority, conf)
  for (const f of a.fields) if ((EXTRA_KEYS as readonly string[]).includes(f.key)) put(f.key as FieldKey, f.value, Math.min(clamp(f.confidence), conf + 0.05))
  const def = typeDef(docType)
  const requiresReview = a.requires_manual_review || conf < 0.7 || docType === UNKNOWN_TYPE || (!!def?.hasExpiry && !fields.expiry_date)
  return { extraction: { engine, engineVersion: model, docType, docTypeConfidence: a.requires_manual_review ? Math.min(conf, 0.69) : conf, fields, alternatives: [] }, warnings, requiresReview }
}
