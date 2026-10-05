// Local, deterministic classifier + field extractor. No network, no third parties.
// Every value carries a confidence and its source so the UI can show *why*; nothing is invented —
// a field is only returned when a matching pattern is literally present in the text.
import { DOC_TYPES, UNKNOWN_TYPE, typeDef, type FieldKey } from './catalog'

export interface Field { value: string; confidence: number; source: 'label' | 'pattern' | 'inferred' | 'mrz' | 'ai' }
export type Fields = Partial<Record<FieldKey, Field>>
export interface Extraction { engine: 'rules' | 'claude' | 'gemini'; engineVersion: string; docType: string; docTypeConfidence: number; fields: Fields; alternatives: { key: string; score: number }[] }

export const RULES_VERSION = 'rules-2026.10.1'

// ── classification ──
export function classify(text: string): { docType: string; confidence: number; alternatives: { key: string; score: number }[] } {
  const t = text.replace(/\s+/g, ' ')
  const scored = DOC_TYPES.map(d => {
    const strong = d.strong.filter(re => re.test(t)).length, weak = d.weak.filter(re => re.test(t)).length
    return { key: d.key, score: strong * 3 + weak, strong }
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score)
  if (!scored.length || scored[0].strong === 0) return { docType: UNKNOWN_TYPE, confidence: scored.length ? 0.2 : 0, alternatives: scored.slice(0, 3).map(({ key, score }) => ({ key, score })) }
  const [best, second] = scored
  let conf = Math.min(0.97, 0.55 + 0.1 * best.score)
  if (second && second.score >= best.score - 1) conf -= 0.2          // ambiguous between two types
  return { docType: best.key, confidence: Math.max(0.3, Math.round(conf * 100) / 100), alternatives: scored.slice(1, 4).map(({ key, score }) => ({ key, score })) }
}

// ── dates ──
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const DATE_RE = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b|\b(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-,]+(\d{4})\b|\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/g
function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) return null
  return dt.toISOString().slice(0, 10)
}
/** Parse one date. Numeric dates are read day-first (UAE convention) unless the year leads. */
export function parseDate(s: string): string | null {
  DATE_RE.lastIndex = 0; const m = DATE_RE.exec(s); return m ? fromMatch(m) : null
}
function fromMatch(m: RegExpExecArray): string | null {
  if (m[1]) return iso(+m[1], +m[2], +m[3])
  if (m[4]) return iso(+m[6], +m[5], +m[4])
  if (m[7]) { const mo = MONTHS[m[8].toLowerCase().slice(0, 4)] ?? MONTHS[m[8].toLowerCase().slice(0, 3)]; return mo ? iso(+m[9], mo, +m[7]) : null }
  if (m[10]) { const mo = MONTHS[m[10].toLowerCase().slice(0, 4)] ?? MONTHS[m[10].toLowerCase().slice(0, 3)]; return mo ? iso(+m[12], mo, +m[11]) : null }
  return null
}
export function allDates(text: string): { iso: string; index: number }[] {
  const out: { iso: string; index: number }[] = []; DATE_RE.lastIndex = 0; let m
  while ((m = DATE_RE.exec(text))) { const v = fromMatch(m); if (v) out.push({ iso: v, index: m.index }) }
  return out
}
/** First date appearing within `window` chars after any of the labels. */
function labelledDate(text: string, labels: RegExp, window = 60): string | null {
  const re = new RegExp(labels.source, 'gi'); let m
  while ((m = re.exec(text))) { const d = parseDate(text.slice(m.index + m[0].length, m.index + m[0].length + window)); if (d) return d }
  return null
}

// ── labelled values ──
/** `Label: value` (colon required, whole-word label) — avoids "to" matching inside "Tourism". */
function labelled(text: string, labels: string, valueRe = '([^\\n|]{2,80})', colon = true): string | null {
  const m = new RegExp(`(?:^|[^A-Za-z])(?:${labels})(?:\\s*name)?\\s*${colon ? '[:#]' : '[:#.\\-]?'}\\s*${valueRe}`, 'im').exec(text)
  return m ? m[1].replace(/\s{2,}/g, ' ').trim().replace(/[,;:.]$/, '') : null
}
const clean = (s: string | null) => (s && s.trim().length >= 2 ? s.trim() : null)

const AUTHORITIES: [RegExp, string][] = [
  [/dubai\s*economy|department\s*of\s*economy\s*and\s*tourism|department\s*of\s*economic\s*development.*dubai|\bDED\b/i, 'Dubai Economy and Tourism (DET)'],
  [/abu\s*dhabi.*economic|\bADDED\b/i, 'Abu Dhabi Department of Economic Development'],
  [/fujairah.*(economic|municipality)|economic\s*development\s*department\s*-?\s*fujairah/i, 'Fujairah Economic Development'],
  [/sharjah\s*economic|\bSEDD\b/i, 'Sharjah Economic Development Department'],
  [/federal\s*tax\s*authority/i, 'Federal Tax Authority'],
  [/federal\s*authority\s*for\s*identity|\bICP\b/i, 'Federal Authority for Identity, Citizenship, Customs & Port Security (ICP)'],
  [/general\s*directorate\s*of\s*residency|\bGDRFA\b/i, 'GDRFA'],
  [/ministry\s*of\s*human\s*resources|\bMOHRE\b/i, 'Ministry of Human Resources & Emiratisation (MOHRE)'],
  [/roads?\s*(and|&)\s*transport\s*authority|\bRTA\b/i, 'Roads & Transport Authority (RTA)'],
  [/dubai\s*land\s*department|real\s*estate\s*regulatory/i, 'Dubai Land Department'],
  [/dubai\s*municipality/i, 'Dubai Municipality'],
  [/chamber\s*of\s*commerce/i, 'Chamber of Commerce'],
  [/civil\s*defen[cs]e/i, 'Civil Defence'],
]

const COMPANY_RE = /\b([A-Z][A-Za-z0-9&'.\- ]{2,80}?\s(?:L\.?L\.?C|LLC|FZ-?LLC|FZE|FZCO|EST\.?|ESTABLISHMENT|TRADING|CONTRACTING|COMPANY|CO\.)\b\.?)/

/** MRZ line 1: P<ISSUER SURNAME<<GIVEN<NAMES ; line 2: number(9) check nationality(3) dob(6) ... expiry(6) */
function mrz(text: string): Fields {
  const lines = text.split(/\n/).map(l => l.replace(/\s+/g, '')).filter(l => /^[A-Z0-9<]{30,}$/.test(l))
  const l1 = lines.find(l => l.startsWith('P<')), l2 = l1 ? lines[lines.indexOf(l1) + 1] : undefined
  const f: Fields = {}
  if (l1) {
    const [sur, given = ''] = l1.slice(5).split('<<')
    const name = `${given.replace(/<+/g, ' ')} ${sur.replace(/<+/g, ' ')}`.replace(/\s+/g, ' ').trim()
    if (name.length > 2) f.holder_name = { value: titleCase(name), confidence: 0.95, source: 'mrz' }
  }
  if (l2 && l2.length >= 28) {
    const num = l2.slice(0, 9).replace(/</g, ''); if (/^[A-Z0-9]{6,9}$/.test(num)) f.document_number = { value: num, confidence: 0.95, source: 'mrz' }
    const yymmdd = (s: string, future: boolean) => { const y = +s.slice(0, 2), yr = future ? 2000 + y : y > 30 ? 1900 + y : 2000 + y; return iso(yr, +s.slice(2, 4), +s.slice(4, 6)) }
    const dob = yymmdd(l2.slice(13, 19), false); if (dob) f.date_of_birth = { value: dob, confidence: 0.95, source: 'mrz' }
    const exp = yymmdd(l2.slice(21, 27), true); if (exp) f.expiry_date = { value: exp, confidence: 0.95, source: 'mrz' }
    const nat = l2.slice(10, 13).replace(/</g, ''); if (/^[A-Z]{3}$/.test(nat)) f.nationality = { value: nat, confidence: 0.8, source: 'mrz' }
  }
  return f
}
export const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase())

// ── extraction ──
export function extractFields(text: string, docType: string): Fields {
  const f: Fields = {}
  const put = (k: FieldKey, v: string | null, confidence: number, source: Field['source'] = 'label') => { if (v && !f[k]) f[k] = { value: v, confidence, source } }
  Object.assign(f, mrz(text))

  // dates (never take date of birth as issue/expiry)
  put('expiry_date', labelledDate(text, /(expiry\s*date|date\s*of\s*expiry|expires?\s*on|expiry|valid\s*(until|till|to|up\s*to)|end\s*date|license\s*expiry|policy\s*expiry|registration\s*expiry|تاريخ\s*الانتهاء)/), 0.9)
  put('issue_date', labelledDate(text, /(issue\s*date|issuing\s*date|date\s*of\s*issue|issued\s*on|registration\s*date|start\s*date|commencement\s*date|effective\s*(date|from)|invoice\s*date|date\s*of\s*registration|تاريخ\s*الإصدار)/), 0.85)
  put('date_of_birth', labelledDate(text, /(date\s*of\s*birth|birth\s*date|\bD\.?O\.?B\b)/, 40), 0.9)
  const def = typeDef(docType)
  if (def?.hasExpiry && !f.expiry_date) {
    const dob = f.date_of_birth?.value
    const ds = [...new Set(allDates(text).map(d => d.iso))].filter(d => d !== dob && d !== f.issue_date?.value).sort()
    if (ds.length) put('expiry_date', ds[ds.length - 1], ds.length === 1 ? 0.5 : 0.55, 'inferred')   // latest remaining date — weak guess, always reviewed
  }
  if (!f.issue_date && def) {
    const ds = allDates(text).map(d => d.iso).filter(d => d !== f.date_of_birth?.value && d !== f.expiry_date?.value).sort()
    if (ds.length && def.hasExpiry) put('issue_date', ds[0], 0.5, 'inferred')
  }

  // numbers by type
  const eid = /\b784-?\d{4}-?\d{7}-?\d\b/.exec(text)
  const trn = /\b(100\d{12})\b/.exec(text)
  if (trn) put('trn', trn[1], 0.9, 'pattern')
  const num = (labels: string, re = '([A-Z0-9][A-Z0-9\\-/]{3,30})') => labelled(text, labels, re, false)
  switch (docType) {
    case 'emirates_id': if (eid) put('document_number', eid[0], 0.95, 'pattern'); break
    case 'passport': put('document_number', num('passport\\s*(?:no|number)\\.?', '([A-Z]{1,2}\\d{6,8})'), 0.9); break
    case 'residence_visa': put('document_number', num('(?:file|u\\.?i\\.?d|visa|permit)\\s*(?:no|number)\\.?'), 0.8); break
    case 'work_permit': put('document_number', num('(?:work\\s*permit|permit|labou?r\\s*card|person\\s*code)\\s*(?:no|number)\\.?'), 0.8); break
    case 'trade_license': put('document_number', num('licen[cs]e\\s*(?:no|number)\\.?'), 0.9); break
    case 'establishment_card': put('document_number', num('establishment\\s*(?:no|number|card\\s*no)\\.?'), 0.85); break
    case 'chamber_certificate': put('document_number', num('membership\\s*(?:no|number)\\.?'), 0.85); break
    case 'vat_certificate': case 'corporate_tax_certificate': if (trn) put('document_number', trn[1], 0.9, 'pattern'); break
    case 'tenancy_contract': case 'ejari': put('document_number', num('contract\\s*(?:no|number)\\.?'), 0.85); break
    case 'company_insurance': case 'medical_insurance': put('document_number', num('(?:policy|member(?:ship)?|card)\\s*(?:no|number|id)\\.?'), 0.85); break
    case 'vehicle_registration': put('plate_number', num('(?:traffic\\s*)?plate\\s*(?:no|number)\\.?', '([A-Z0-9][A-Z0-9 \\-/]{1,15}?)(?=\\s{2,}|\\n|$)'), 0.85); put('document_number', num('(?:traffic\\s*code(?:\\s*no)?|t\\.?c\\.?\\s*no|chassis\\s*(?:no|number))\\.?'), 0.8); break
    case 'tax_invoice': put('document_number', num('invoice\\s*(?:no|number|#)\\.?'), 0.9); break
    case 'quotation': put('document_number', num('(?:quotation|quote|ref)\\s*(?:no|number|#)\\.?') ?? (/\bQT-[\w-]+/.exec(text)?.[0] ?? null), 0.9); break
    case 'delivery_note': put('document_number', num('(?:delivery\\s*note|DN|D\\.N\\.)\\s*(?:no|number|#)\\.?') ?? (/\bDN-[\w-]+/.exec(text)?.[0] ?? null), 0.9); break
    case 'purchase_order': put('document_number', num('(?:purchase\\s*order|P\\.?O\\.?)\\s*(?:no|number|#)\\.?'), 0.9); break
  }
  if (['receipt', 'credit_note', 'supplier_invoice'].includes(docType)) put('document_number', num('(?:receipt|credit\\s*note|invoice|voucher|ref)\\s*(?:no|number|#)\\.?'), 0.85)
  if (docType === 'drawing') put('document_number', num('(?:drawing|dwg)\\s*(?:no|number)\\.?'), 0.85)
  if (['vehicle_insurance', 'inspection_certificate', 'maintenance_document'].includes(docType)) {
    put('plate_number', num('(?:traffic\\s*)?plate\\s*(?:no|number)\\.?', '([A-Z0-9][A-Z0-9 \\-/]{1,15}?)(?=\\s{2,}|\\n|$)'), 0.8)
    put('document_number', num('(?:policy|certificate|job\\s*card|report)\\s*(?:no|number)\\.?'), 0.8)
  }
  const po = num('(?:L\\.?P\\.?O\\.?|P\\.?O\\.?|purchase\\s*order)\\s*(?:no|number|ref|#)\\.?')
  if (po && docType !== 'purchase_order') put('po_number', po, 0.8)
  put('employee_id', labelled(text, '(?:employee\\s*(?:id|no|number|code)|staff\\s*(?:id|no))', '([A-Z]{0,4}-?\\d{1,6})', false), 0.8)
  put('project_name', clean(labelled(text, '(?:project(?:\\s*name)?|job\\s*name)', "([A-Za-z0-9][A-Za-z0-9&,'.\\- ]{2,80})")), 0.75)
  if (docType === 'supplier_invoice') put('supplier_name', clean(labelled(text, '(?:supplier|vendor|bill\\s*from|from)', "([A-Za-z0-9][A-Za-z0-9&'.\\- ]{2,80})")), 0.8)
  if (!f.document_number && eid && docType !== 'emirates_id') { /* an EID on a visa etc. is a holder identifier, not this document's number */ }

  // people & parties — only the fields that make sense for this kind of document
  const kind = def?.owner ?? 'unknown', any = kind === 'unknown'
  const conf = (c: number) => (any ? Math.min(c, 0.5) : c)
  if (kind === 'employee' || any) {
    put('holder_name', clean(labelled(text, '(?:full\\s*name|name\\s*of\\s*holder|holder|employee|member|insured\\s*member|(?<!(?:trade|company|legal|landlord|tenant|registered|owner)\\s)name)', "([A-Za-z][A-Za-z .'\\-]{2,60})")), conf(0.85))
    put('nationality', clean(labelled(text, 'nationality', "([A-Za-z][A-Za-z ]{2,30})")), conf(0.85))
    put('employer', clean(labelled(text, '(?:employer|sponsor|establishment)', "([A-Za-z0-9][A-Za-z0-9&'.\\- ]{2,80})")), conf(0.75))
    put('profession', clean(labelled(text, '(?:profession|occupation|designation|job\\s*title)', "([A-Za-z][A-Za-z /\\-]{2,40})")), conf(0.8))
  }
  if (kind === 'company' || kind === 'vehicle' || any) {
    put('company_name', clean(labelled(text, '(?:trade|company|legal|registered|licensee|insured|owner)', "([A-Za-z0-9][A-Za-z0-9&'.\\- ]{2,80})")), conf(0.8))
    if (!f.company_name && (docType === 'tenancy_contract' || docType === 'ejari')) put('company_name', clean(labelled(text, '(?:tenant|lessee)', "([A-Za-z0-9][A-Za-z0-9&'.\\- ]{2,80})")), 0.8)
    if (!f.company_name) { const m = COMPANY_RE.exec(text); if (m) put('company_name', m[1].trim(), conf(0.6), 'pattern') }
    put('license_type', clean(labelled(text, '(?:licen[cs]e\\s*type|legal\\s*(?:type|form))', "([A-Za-z][A-Za-z /\\-]{2,40})")), conf(0.8))
  }
  if (docType === 'tenancy_contract' || docType === 'ejari' || any) {
    put('landlord', clean(labelled(text, '(?:landlord|lessor)', "([A-Za-z0-9][A-Za-z0-9&'.\\- ]{2,80})")), conf(0.8))
    put('tenant', clean(labelled(text, '(?:tenant|lessee)', "([A-Za-z0-9][A-Za-z0-9&'.\\- ]{2,80})")), conf(0.8))
    put('property', clean(labelled(text, '(?:property|premises|location)', "([A-Za-z0-9][A-Za-z0-9,'.\\-/ ]{2,100})")), conf(0.7))
  }
  if (kind === 'customer' || any) {
    put('customer_name', clean(labelled(text, '(?:bill\\s*to|customer|client|messrs\\.?|delivered\\s*to|ship\\s*to)', "([A-Za-z0-9][A-Za-z0-9&'.\\- ]{2,80})")), conf(0.85))
    if (!f.issue_date) put('issue_date', labelledDate(text, /(?:^|\n)\s*date\s*:/), conf(0.75))
  }
  if (kind === 'customer' || kind === 'supplier' || docType === 'tenancy_contract' || docType === 'ejari' || docType === 'company_insurance' || any) {
    const amt = labelled(text, '(?:grand\\s*total|total\\s*amount|amount\\s*due|net\\s*total|annual\\s*rent|sum\\s*insured|total)', '(?:\\(?AED\\)?\\s*)?([0-9][0-9,]*(?:\\.\\d{1,2})?)')
    if (amt) put('amount', amt.replace(/,/g, ''), conf(0.8))
  }
  for (const [re, name] of AUTHORITIES) if (re.test(text)) { put('issuing_authority', name, 0.85, 'pattern'); break }
  return f
}

export function rulesExtract(text: string): Extraction {
  const c = classify(text)
  return { engine: 'rules', engineVersion: RULES_VERSION, docType: c.docType, docTypeConfidence: c.confidence, fields: c.docType === UNKNOWN_TYPE ? extractFields(text, '') : extractFields(text, c.docType), alternatives: c.alternatives }
}
