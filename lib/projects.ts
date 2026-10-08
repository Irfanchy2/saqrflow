// Project money maths (pure, unit-tested).
export const PROJECT_STATUS: Record<string, { label: string; tone: 'neutral' | 'blue' | 'green' | 'amber' | 'red' }> = {
  planning: { label: 'Planning', tone: 'neutral' }, active: { label: 'Active', tone: 'blue' }, on_hold: { label: 'On hold', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
}
export const EXPENSE_CATS: Record<string, string> = {
  material: 'Materials', labour: 'Labour', subcontract: 'Subcontract', transport: 'Transport', fuel: 'Fuel', equipment: 'Equipment',
  accommodation: 'Accommodation', food: 'Food', maintenance: 'Maintenance', other: 'Other',
}
export const PHOTO_CATS = { before: 'Before', fabrication: 'Fabrication', installation: 'Installation', progress: 'Progress', completed: 'Completed' } as const
export const PAYMENT_METHODS: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', credit: 'On credit (unpaid)', other: 'Other' }

export interface ProjInvoice { doc_type: string; status: string; total: number | string; vat_amount?: number | string | null; paid?: number }
/**
 * Profitability from recorded data only (nothing estimated or guessed):
 * - revenue is ex-VAT (VAT is collected for the FTA, not income); issued credit notes reduce it
 * - estimated profit = contract value (else accepted quotation, else invoiced) − recorded costs
 * - actual profit = invoiced (ex-VAT) − recorded costs
 */
export function projectFinancials(contract: number | string | null, invoices: ProjInvoice[], expenses: { amount: number | string; category?: string }[]) {
  const live = (i: ProjInvoice) => !['draft', 'cancelled'].includes(i.status)
  const issued = invoices.filter(i => i.doc_type === 'invoice' && live(i))
  const credits = invoices.filter(i => i.doc_type === 'credit_note' && live(i))
  const net = (i: ProjInvoice) => Number(i.total) - Number(i.vat_amount ?? 0)
  const invoiced = issued.reduce((s, i) => s + Number(i.total), 0) - credits.reduce((s, i) => s + Number(i.total), 0)
  const invoicedNet = issued.reduce((s, i) => s + net(i), 0) - credits.reduce((s, i) => s + net(i), 0)
  const received = issued.reduce((s, i) => s + Number(i.paid ?? 0), 0)
  const quoted = invoices.filter(i => i.doc_type === 'quotation' && ['accepted', 'converted'].includes(i.status)).reduce((s, i) => s + net(i), 0)
  const spent = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const value = Number(contract ?? 0) || quoted || invoicedNet
  const profit = value - spent, actualProfit = invoicedNet - spent
  const byCategory: Record<string, number> = {}
  for (const e of expenses) byCategory[e.category ?? 'other'] = (byCategory[e.category ?? 'other'] ?? 0) + Number(e.amount)
  const r1 = (n: number) => Math.round(n * 10) / 10
  return {
    contract: Number(contract ?? 0), quoted, value, invoiced, invoicedNet, received, outstanding: Math.max(0, invoiced - received), expenses: spent,
    profit, margin: value > 0 ? r1((profit / value) * 100) : null, actualProfit, actualMargin: invoicedNet > 0 ? r1((actualProfit / invoicedNet) * 100) : null,
    billedPct: Number(contract) > 0 ? Math.min(100, Math.round((invoiced / Number(contract)) * 100)) : null,
    collectedPct: invoiced > 0 ? Math.min(100, Math.round((received / invoiced) * 100)) : null, byCategory,
  }
}
