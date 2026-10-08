// Turns an extraction + matches + duplicate candidates into a filing suggestion. Pure (unit-tested).
import { typeDef, UNKNOWN_TYPE } from './catalog'
import type { Extraction } from './rules'
import type { Match } from './match'

export const AUTO_SUGGEST_THRESHOLD = 0.8      // ≥ → "ready" (still needs one-click confirmation)
export const OWNER_THRESHOLD = 0.85

export interface DuplicateCandidate { documentId: string; name: string; kind: 'same_file' | 'same_number' | 'renewal'; expiry: string | null; ownerId: string | null }
export interface Suggestion {
  docType: string; label: string; ownerKind: string | null
  owner: { id: string | null; name: string; confidence: number; reason?: string } | null
  ownerCandidates: Match[]
  path: string[]; category: string
  duplicates: DuplicateCandidate[]
  warnings: string[]
}
export interface Decision { status: 'ready' | 'needs_review' | 'duplicate'; confidence: number; reasons: string[]; suggestion: Suggestion }

export interface DecideCtx { companyName: string; companyMatch: number; employees: Match[]; customers: Match[]; suppliers?: Match[]; projects?: Match[]; vehicles?: Match[]; duplicates: DuplicateCandidate[]; hasText: boolean }
export function decide(x: Extraction, ctx: DecideCtx): Decision {
  const def = typeDef(x.docType)
  const reasons: string[] = [], warnings: string[] = []
  if (!ctx.hasText && x.engine === 'rules') reasons.push('No readable text found. Upload a sharper scan, enable AI reading in Settings, or enter the details manually')
  if (!def || x.docType === UNKNOWN_TYPE) reasons.push('Document type not recognised')
  else if (x.docTypeConfidence < AUTO_SUGGEST_THRESHOLD) reasons.push(`Document type uncertain (${Math.round(x.docTypeConfidence * 100)}%)`)

  let owner: Suggestion['owner'] = null, candidates: Match[] = []
  if (def?.owner === 'company') {
    // single-company account: the owner is this company; a name that doesn't resemble it lowers confidence and warns
    const nameOk = !x.fields.company_name || ctx.companyMatch >= 0.5
    owner = { id: null, name: ctx.companyName, confidence: nameOk ? 0.95 : 0.7, reason: x.fields.company_name ? (nameOk ? 'Company name on document matches' : undefined) : 'Only company in this account' }
    if (x.fields.company_name && ctx.companyMatch < 0.5) warnings.push(`Company on the document (“${x.fields.company_name.value}”) differs from ${ctx.companyName}`)
  } else if (def?.owner === 'employee') {
    candidates = ctx.employees
    const [a, b] = ctx.employees
    if (a && a.confidence >= OWNER_THRESHOLD && (!b || a.confidence - b.confidence >= 0.1)) owner = { id: a.id, name: a.name, confidence: a.confidence, reason: a.reason }
    else reasons.push(a ? 'Employee match not certain. Please confirm who this belongs to' : 'No matching employee found')
  } else if (def?.owner === 'customer') {
    candidates = ctx.customers
    const [a] = ctx.customers
    if (a && a.confidence >= OWNER_THRESHOLD) owner = { id: a.id, name: a.name, confidence: a.confidence, reason: a.reason }
    else reasons.push(x.fields.customer_name ? `Customer “${x.fields.customer_name.value}” not found in Clients` : 'Customer not identified')
  } else if (def?.owner === 'supplier') {
    candidates = ctx.suppliers ?? []
    const [a] = candidates
    if (a && a.confidence >= OWNER_THRESHOLD) owner = { id: a.id, name: a.name, confidence: a.confidence, reason: a.reason }
    else reasons.push(x.fields.supplier_name ? `Supplier “${x.fields.supplier_name.value}” not found in Suppliers` : 'Supplier not identified')
  } else if (def?.owner === 'project') {
    candidates = ctx.projects ?? []
    const [a] = candidates
    if (a && a.confidence >= OWNER_THRESHOLD) owner = { id: a.id, name: a.name, confidence: a.confidence, reason: a.reason }
    else reasons.push('Project not identified. Choose the project')
  } else if (def?.owner === 'vehicle') {
    const plate = x.fields.plate_number?.value
    candidates = ctx.vehicles ?? []
    const [a] = candidates
    if (a && a.confidence >= OWNER_THRESHOLD) owner = { id: a.id, name: a.name, confidence: a.confidence, reason: a.reason }
    else owner = { id: null, name: plate ? `Plate ${plate}` : 'Vehicle', confidence: plate ? 0.85 : 0.5 }
    if (!plate) reasons.push('Plate number not found')
  }

  if (def?.hasExpiry) {
    const e = x.fields.expiry_date
    if (!e) reasons.push('Expiry date not found')
    else if (e.confidence < AUTO_SUGGEST_THRESHOLD) reasons.push('Expiry date needs checking')
  }
  const sameFile = ctx.duplicates.find(d => d.kind === 'same_file')
  if (ctx.duplicates.some(d => d.kind === 'same_number')) reasons.push('Possible duplicate detected')

  const path = (def?.path ?? ['Needs review']).map(p => p.replace('{company}', ctx.companyName).replace('{employee}', owner?.name ?? '?').replace('{customer}', owner?.name ?? x.fields.customer_name?.value ?? '?').replace('{vehicle}', owner?.name ?? '?').replace('{supplier}', owner?.name ?? x.fields.supplier_name?.value ?? '?').replace('{project}', owner?.name ?? x.fields.project_name?.value ?? '?'))
  const confidence = Math.round(Math.min(x.docTypeConfidence, owner?.confidence ?? (def ? 0.5 : 0), def?.hasExpiry ? (x.fields.expiry_date?.confidence ?? 0.4) : 1) * 100) / 100
  return {
    status: sameFile ? 'duplicate' : reasons.length ? 'needs_review' : 'ready',
    confidence, reasons: sameFile ? ['Exact same file was already uploaded', ...reasons] : reasons,
    suggestion: { docType: x.docType, label: def?.label ?? 'Unknown document', ownerKind: def?.owner ?? null, owner, ownerCandidates: candidates, path, category: def?.category ?? '', duplicates: ctx.duplicates, warnings },
  }
}
