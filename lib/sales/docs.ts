// Sales document types (Quotation / Tax Invoice / Delivery Note …) — shared by UI, PDF and server actions.
export type SalesType = 'quotation' | 'invoice' | 'delivery_note' | 'purchase_order' | 'credit_note' | 'receipt'
export const SALES_TYPES: SalesType[] = ['quotation', 'invoice', 'delivery_note', 'credit_note']

export interface DocMeta { label: string; plural: string; short: string; paperTitle: string; priced: boolean; statuses: string[]; folder: string; category: string; relatedType: string }
export const DOC_META: Record<SalesType, DocMeta> = {
  quotation: { label: 'Quotation', plural: 'Quotations', short: 'QTN', paperTitle: 'QUOTATION', priced: true, statuses: ['draft', 'sent', 'viewed', 'follow_up', 'accepted', 'rejected', 'expired', 'converted', 'cancelled'], folder: 'Quotations', category: 'Customer Quotation', relatedType: 'quotation' },
  invoice: { label: 'Tax Invoice', plural: 'Tax Invoices', short: 'INV', paperTitle: 'Tax Invoice', priced: true, statuses: ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'], folder: 'Invoices', category: 'Customer Invoice', relatedType: 'invoice' },
  delivery_note: { label: 'Delivery Note', plural: 'Delivery Notes', short: 'DN', paperTitle: 'Delivery Note', priced: false, statuses: ['draft', 'sent', 'delivered', 'cancelled'], folder: 'Delivery Notes', category: 'Customer Delivery Note', relatedType: 'delivery_note' },
  purchase_order: { label: 'Purchase Order', plural: 'Purchase Orders', short: 'PO', paperTitle: 'PURCHASE ORDER', priced: true, statuses: ['draft', 'sent', 'accepted', 'cancelled'], folder: 'Purchase Orders', category: 'Purchase Order', relatedType: 'purchase_order' },
  credit_note: { label: 'Credit Note', plural: 'Credit Notes', short: 'CN', paperTitle: 'Tax Credit Note', priced: true, statuses: ['draft', 'sent', 'cancelled'], folder: 'Credit Notes', category: 'Customer Invoice', relatedType: 'credit_note' },
  receipt: { label: 'Receipt', plural: 'Receipts', short: 'RCT', paperTitle: 'RECEIPT', priced: true, statuses: ['draft', 'sent', 'cancelled'], folder: 'Receipts', category: 'Customer Invoice', relatedType: 'invoice' },
}
export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', viewed: 'Viewed', follow_up: 'Follow-up required', accepted: 'Accepted', rejected: 'Rejected', expired: 'Expired',
  converted: 'Converted', partially_paid: 'Partially paid', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled', delivered: 'Delivered',
}
/** the same stored status reads differently per document type ("sent" credit note = issued) */
export const statusLabel = (t: SalesType, s: string) => (s === 'sent' && t === 'credit_note' ? 'Issued' : STATUS_LABEL[s] ?? s)
export const STATUS_TONE: Record<string, 'neutral' | 'blue' | 'green' | 'amber' | 'red'> = {
  draft: 'neutral', sent: 'blue', viewed: 'blue', follow_up: 'amber', accepted: 'green', rejected: 'red', expired: 'neutral', converted: 'green',
  partially_paid: 'amber', paid: 'green', overdue: 'red', cancelled: 'neutral', delivered: 'green',
}
export const APPROVAL_LABEL: Record<string, string> = { pending: 'Pending approval', approved: 'Approved', rejected: 'Approval rejected', changes_requested: 'Changes requested' }
export const APPROVAL_TONE: Record<string, 'neutral' | 'blue' | 'green' | 'amber' | 'red'> = { pending: 'amber', approved: 'green', rejected: 'red', changes_requested: 'amber' }
/** Statuses a user may set by hand (payment statuses are automatic). */
export function manualStatuses(t: SalesType, current: string): string[] {
  if (t === 'invoice') return current === 'draft' ? ['sent', 'cancelled'] : current === 'cancelled' ? [] : ['cancelled']
  if (t === 'credit_note') return current === 'draft' ? ['sent', 'cancelled'] : current === 'cancelled' ? [] : ['cancelled']
  if (t === 'quotation') return current === 'cancelled' ? [] : ['sent', 'viewed', 'follow_up', 'accepted', 'rejected', 'expired', 'cancelled'].filter(s => s !== current && !(current === 'draft' && s !== 'sent' && s !== 'cancelled'))
  if (t === 'delivery_note') return ['sent', 'delivered', 'cancelled'].filter(s => s !== current)
  return ['sent', 'cancelled'].filter(s => s !== current)
}
/** Which documents can be created from this one. */
export const CONVERSIONS: Partial<Record<SalesType, SalesType[]>> = { quotation: ['invoice', 'delivery_note'], invoice: ['delivery_note', 'credit_note'], delivery_note: ['invoice'] }
/** documents that carry VAT columns on paper (tax invoice, tax credit note) */
export const isTaxDoc = (t: SalesType) => t === 'invoice' || t === 'credit_note'

/**
 * Units offered in the line editor and the catalog. The code is stored and printed exactly as shown ("L.S", "SQM" …).
 * Older lines keep whatever unit they were saved with (e.g. "Sq.Mtr", "Rmt", "Kg"): the pickers always include the
 * current value, and anything else can be typed through "Other…".
 */
export const UNIT_OPTIONS: { code: string; label: string }[] = [
  { code: 'Nos', label: 'Numbers' }, { code: 'PCS', label: 'Pieces' }, { code: 'L.S', label: 'Lump sum' }, { code: 'LM', label: 'Linear metre' },
  { code: 'RMT', label: 'Running metre' }, { code: 'MTR', label: 'Metre' }, { code: 'SQM', label: 'Square metre' }, { code: 'CUM', label: 'Cubic metre' },
  { code: 'KG', label: 'Kilogram' }, { code: 'TON', label: 'Tonne' }, { code: 'SET', label: 'Set' }, { code: 'LOT', label: 'Lot' },
  { code: 'PAIR', label: 'Pair' }, { code: 'BOX', label: 'Box' }, { code: 'ROLL', label: 'Roll' }, { code: 'LTR', label: 'Litre' },
  { code: 'JOB', label: 'Job' }, { code: 'HRS', label: 'Hours' }, { code: 'DAYS', label: 'Days' }, { code: 'MONTH', label: 'Month' },
]
export const UNITS = UNIT_OPTIONS.map(u => u.code)
export const UNIT_MAX = 20
/** The picker list for a line: the standard units, plus the line's own unit when it is not one of them. */
export const unitChoices = (current?: string | null) => (current && !UNITS.includes(current) ? [current, ...UNITS] : UNITS)
/** "12.5 SQM" — the quantity and its unit as printed (every unit, "Nos" included). */
export const fmtQty = (q: number | string | null | undefined) => { const n = Number(q || 0); return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 3 }) }

export const DEFAULTS = {
  intro: 'Dear Sir/Mam,\nThank You so much for kind enquiry, please see our best offer for the requested work',
  closing: 'NB. Vat 5% Will Be Applied on Above Quote\nWe Hope Above Meets your Approval And look Forward to Receive Your Order/Comments in Return.',
  terms: ['Quote validity: - 30 Days'],
  paymentTerms: ['60% Advance Payment', '30% Materials on site', '10% after completion of works'],
  vatRate: 5,
  dueDays: 30,
  validityDays: 30,
  followupDays: [3, 10],
}
