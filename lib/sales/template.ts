// Document template builder (Settings → Template builder). One definition per document type, applied identically by the
// A4 paper (editor preview / print) and the PDF. Defaults reproduce the standard Al Saqr layout exactly, so nothing changes
// until a template is edited. UAE tax-invoice essentials (company TRN, VAT columns, totals) are not switchable.
import { isTaxDoc, type SalesType } from './docs'

export const TEMPLATE_KINDS = ['quotation', 'invoice', 'delivery_note'] as const
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]
export const TEMPLATE_LABEL: Record<TemplateKind, string> = { quotation: 'Quotation', invoice: 'Tax invoice', delivery_note: 'Delivery note' }

export const FIELD_KEYS = ['attention', 'customer_trn', 'phone', 'email', 'site', 'project', 'lpo', 'del_no', 'reference', 'due_date', 'valid_until'] as const
export type FieldKey = (typeof FIELD_KEYS)[number]
export const FIELD_LABEL: Record<FieldKey, string> = {
  attention: 'Attention', customer_trn: 'Customer TRN', phone: 'Customer phone', email: 'Customer email', site: 'Site / delivery address', project: 'Project',
  lpo: 'L.P.O number', del_no: 'Delivery note number', reference: 'Customer reference', due_date: 'Due date', valid_until: 'Valid till',
}
/** which fields make sense on which document */
export const FIELDS_FOR: Record<TemplateKind, FieldKey[]> = {
  quotation: ['attention', 'customer_trn', 'phone', 'email', 'site', 'project', 'reference', 'valid_until'],
  invoice: ['attention', 'customer_trn', 'phone', 'email', 'site', 'project', 'lpo', 'del_no', 'reference', 'due_date'],
  delivery_note: ['attention', 'customer_trn', 'phone', 'email', 'site', 'project', 'lpo', 'reference'],
}

export interface DocTemplate {
  title: string; scopeHeading: string
  fields: Record<FieldKey, boolean>
  labels: { description: string; qty: string; rate: string; total: string }
  showSignature: boolean; showBank: boolean; showWords: boolean; showComputerLine: boolean
  footerNote: string
}

export const templateKind = (t: SalesType): TemplateKind | null => (t === 'quotation' || t === 'invoice' || t === 'delivery_note' ? t : null)

/** The standard layout for a document type (exactly what the paper and PDF printed before templates existed). */
export function defaultTemplate(t: SalesType): DocTemplate {
  const inv = isTaxDoc(t), qtn = t === 'quotation', cn = t === 'credit_note'
  return {
    title: '', scopeHeading: inv ? '' : 'The scope of works:-',
    fields: { attention: qtn, customer_trn: !qtn, phone: true, email: true, site: true, project: true, lpo: !qtn, del_no: inv && !cn, reference: true, due_date: inv, valid_until: qtn },
    labels: inv ? { description: 'DESCRIPTION', qty: 'QTY.', rate: 'Rate', total: 'Amount' } : { description: 'DESCRIPTION', qty: 'QTY.', rate: 'Unit price (dhs)', total: 'Total Price (dhs)' },
    showSignature: !inv, showBank: inv, showWords: inv, showComputerLine: inv, footerNote: '',
  }
}

const str = (v: unknown, max: number, d: string) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max) : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

/** Stored template (any shape) → a complete, safe template for this document. Overrides apply only to their own type. */
export function resolveTemplate(t: SalesType, stored?: unknown): DocTemplate {
  const d = defaultTemplate(t)
  if (!stored || typeof stored !== 'object' || templateKind(t) === null) return d
  const s = stored as Record<string, any>, allowed = new Set<FieldKey>(FIELDS_FOR[templateKind(t)!])
  const fields = { ...d.fields }
  for (const k of FIELD_KEYS) if (allowed.has(k)) fields[k] = bool(s.fields?.[k], d.fields[k])
  return {
    title: str(s.title, 40, ''), scopeHeading: str(s.scopeHeading, 80, d.scopeHeading), fields,
    labels: { description: str(s.labels?.description, 30, d.labels.description) || d.labels.description, qty: str(s.labels?.qty, 20, d.labels.qty) || d.labels.qty,
      rate: str(s.labels?.rate, 30, d.labels.rate) || d.labels.rate, total: str(s.labels?.total, 30, d.labels.total) || d.labels.total },
    showSignature: bool(s.showSignature, d.showSignature), showBank: bool(s.showBank, d.showBank),
    showWords: isTaxDoc(t) ? bool(s.showWords, d.showWords) : false, showComputerLine: isTaxDoc(t) ? bool(s.showComputerLine, d.showComputerLine) : false,
    footerNote: str(s.footerNote, 300, ''),
  }
}

/** What is saved: only differences from the default are meaningful, but the full object is stored for clarity. */
export function sanitizeTemplate(kind: TemplateKind, raw: unknown): DocTemplate { return resolveTemplate(kind, raw) }
export const isDefault = (kind: TemplateKind, tp: DocTemplate) => JSON.stringify(tp) === JSON.stringify(defaultTemplate(kind))
