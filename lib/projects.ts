// Project money maths (pure, unit-tested).
export const PROJECT_STATUS: Record<string, { label: string; tone: 'neutral' | 'blue' | 'green' | 'amber' | 'red' }> = {
  planning: { label: 'Planning', tone: 'neutral' }, active: { label: 'Active', tone: 'blue' }, on_hold: { label: 'On hold', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
}
export const EXPENSE_CATS: Record<string, string> = { material: 'Materials', labour: 'Labour', transport: 'Transport', subcontract: 'Subcontract', equipment: 'Equipment', other: 'Other' }

export interface ProjInvoice { doc_type: string; status: string; total: number | string; paid?: number }
export function projectFinancials(contract: number | string | null, invoices: ProjInvoice[], expenses: { amount: number | string; category?: string }[]) {
  const issued = invoices.filter(i => i.doc_type === 'invoice' && !['draft', 'cancelled'].includes(i.status))
  const invoiced = issued.reduce((s, i) => s + Number(i.total), 0)
  const received = issued.reduce((s, i) => s + Number(i.paid ?? 0), 0)
  const spent = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const value = Number(contract ?? 0) || invoiced
  const profit = value - spent
  const byCategory: Record<string, number> = {}
  for (const e of expenses) byCategory[e.category ?? 'other'] = (byCategory[e.category ?? 'other'] ?? 0) + Number(e.amount)
  return {
    contract: Number(contract ?? 0), invoiced, received, outstanding: Math.max(0, invoiced - received), expenses: spent,
    profit, margin: value > 0 ? Math.round((profit / value) * 1000) / 10 : null,
    billedPct: Number(contract) > 0 ? Math.min(100, Math.round((invoiced / Number(contract)) * 100)) : null,
    collectedPct: invoiced > 0 ? Math.min(100, Math.round((received / invoiced) * 100)) : null, byCategory,
  }
}
