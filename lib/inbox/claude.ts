import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import * as z from 'zod/v4'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { DOC_TYPES, UNKNOWN_TYPE, type FieldKey } from './catalog'
import type { Extraction, Fields } from './rules'

export const CLAUDE_MODEL = 'claude-opus-5-5'
const FIELD_KEYS = ['holder_name', 'company_name', 'document_number', 'issue_date', 'expiry_date', 'date_of_birth', 'nationality', 'employer', 'profession',
  'issuing_authority', 'license_type', 'trn', 'landlord', 'tenant', 'property', 'amount', 'customer_name', 'plate_number'] as const satisfies readonly FieldKey[]

const Schema = z.object({
  doc_type: z.enum([UNKNOWN_TYPE, ...DOC_TYPES.map(d => d.key)] as [string, ...string[]]),
  doc_type_confidence: z.number(),
  fields: z.array(z.object({ key: z.enum(FIELD_KEYS), value: z.string(), confidence: z.number() })),
})

const SYSTEM = `You read UAE business, government and HR documents (trade licences, Emirates IDs, visas, passports, tenancy contracts, insurance, invoices, etc.) and return structured metadata.
Rules:
- Only report a field if it is literally visible in the document. Never guess, infer or invent a value; omit the field instead.
- Dates must be ISO YYYY-MM-DD. UAE numeric dates are day-first (05/03/2027 = 2027-03-05).
- confidence is 0..1: how sure you are the value was read correctly from the document. Use < 0.7 when the text is blurry, partial or ambiguous.
- doc_type must be one of the allowed keys; use "unknown" when the document does not clearly match one.
- amount = the document's total in AED as a plain number, no currency or commas.
Allowed doc types: ${DOC_TYPES.map(d => `${d.key} (${d.label})`).join(', ')}.`

export const claudeAvailable = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)

/** OCR + classification + extraction in one request (handles scans and photos). */
export async function claudeExtract(buf: Uint8Array, mime: string, text: string): Promise<Extraction> {
  const client = new Anthropic()
  const b64 = Buffer.from(buf).toString('base64')
  const file: Anthropic.Beta.Messages.BetaContentBlockParam =
    mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime as 'image/jpeg' | 'image/png' | 'image/webp', data: b64 } }
  const res = await client.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(Schema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: [file, { type: 'text', text: text ? `Text layer (may be incomplete):\n${text.slice(0, 20000)}\n\nExtract the metadata.` : 'Extract the metadata.' }] }],
  })
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error(res.stop_reason === 'refusal' ? 'The AI declined to read this document' : 'The AI returned no usable result')
  const out = res.parsed_output
  const fields: Fields = {}
  for (const f of out.fields) if (f.value?.trim()) fields[f.key] = { value: f.value.trim(), confidence: Math.max(0, Math.min(1, f.confidence)), source: 'ai' }
  return { engine: 'claude', engineVersion: res.model, docType: out.doc_type, docTypeConfidence: Math.max(0, Math.min(1, out.doc_type_confidence)), fields, alternatives: [] }
}
