// Sales document types (Quotation / Tax Invoice / Delivery Note …) — shared by UI, PDF and server actions.
export type SalesType = 'quotation' | 'invoice' | 'delivery_note' | 'purchase_order' | 'credit_note' | 'receipt'
export const SALES_TYPES: SalesType[] = ['quotation', 'invoice', 'delivery_note']

export interface DocMeta { label: string; plural: string; short: string; paperTitle: string; priced: boolean; statuses: string[]; folder: string; category: string; relatedType: string }
export const DOC_META: Record<SalesType, DocMeta> = {
  quotation: { label: 'Quotation', plural: 'Quotations', short: 'QTN', paperTitle: 'QUOTATION', priced: true, statuses: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled'], folder: 'Quotations', category: 'Customer Quotation', relatedType: 'quotation' },
  invoice: { label: 'Tax Invoice', plural: 'Tax Invoices', short: 'INV', paperTitle: 'Tax Invoice', priced: true, statuses: ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'], folder: 'Invoices', category: 'Customer Invoice', relatedType: 'invoice' },
  delivery_note: { label: 'Delivery Note', plural: 'Delivery Notes', short: 'DN', paperTitle: 'Delivery Note', priced: false, statuses: ['draft', 'sent', 'delivered', 'cancelled'], folder: 'Delivery Notes', category: 'Customer Delivery Note', relatedType: 'delivery_note' },
  purchase_order: { label: 'Purchase Order', plural: 'Purchase Orders', short: 'PO', paperTitle: 'PURCHASE ORDER', priced: true, statuses: ['draft', 'sent', 'accepted', 'cancelled'], folder: 'Purchase Orders', category: 'Purchase Order', relatedType: 'purchase_order' },
  credit_note: { label: 'Credit Note', plural: 'Credit Notes', short: 'CN', paperTitle: 'CREDIT NOTE', priced: true, statuses: ['draft', 'sent', 'cancelled'], folder: 'Credit Notes', category: 'Customer Invoice', relatedType: 'invoice' },
  receipt: { label: 'Receipt', plural: 'Receipts', short: 'RCT', paperTitle: 'RECEIPT', priced: true, statuses: ['draft', 'sent', 'cancelled'], folder: 'Receipts', category: 'Customer Invoice', relatedType: 'invoice' },
}
export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', accepted: 'Accepted', rejected: 'Rejected', expired: 'Expired', partially_paid: 'Partially paid',
  paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled', delivered: 'Delivered',
}
export const STATUS_TONE: Record<string, 'neutral' | 'blue' | 'green' | 'amber' | 'red'> = {
  draft: 'neutral', sent: 'blue', accepted: 'green', rejected: 'red', expired: 'amber', partially_paid: 'amber', paid: 'green', overdue: 'red', cancelled: 'neutral', delivered: 'green',
}
/** Statuses a user may set by hand (payment statuses are automatic). */
export function manualStatuses(t: SalesType, current: string): string[] {
  if (t === 'invoice') return current === 'draft' ? ['sent', 'cancelled'] : current === 'cancelled' ? [] : ['cancelled']
  if (t === 'quotation') return ['sent', 'accepted', 'rejected', 'expired', 'cancelled'].filter(s => s !== current)
  if (t === 'delivery_note') return ['sent', 'delivered', 'cancelled'].filter(s => s !== current)
  return ['sent', 'cancelled'].filter(s => s !== current)
}
/** Which documents can be created from this one. */
export const CONVERSIONS: Partial<Record<SalesType, SalesType[]>> = { quotation: ['invoice', 'delivery_note'], invoice: ['delivery_note'], delivery_note: ['invoice'] }

export const UNITS = ['Nos', 'Sq.Mtr', 'Mtr', 'Rmt', 'Kg', 'Ton', 'Set', 'Pcs', 'Lot', 'L.S', 'Job', 'Hrs', 'Days'] as const

export const DEFAULTS = {
  intro: 'Dear Sir/Mam,\nThank You so much for kind enquiry, please see our best offer for the requested work',
  closing: 'NB. Vat 5% Will Be Applied on Above Quote\nWe Hope Above Meets your Approval And look Forward to Receive Your Order/Comments in Return.',
  terms: ['Quote validity: - 30 Days'],
  paymentTerms: ['60% Advance Payment', '30% Materials on site', '10% after completion of works'],
  vatRate: 5,
  dueDays: 30,
  validityDays: 30,
}
