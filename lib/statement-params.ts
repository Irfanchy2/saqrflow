/** Statement / ledger filters from the URL: date-only strings (YYYY-MM-DD) are used as-is — no UTC conversion. */
export type StatementType = 'full' | 'unpaid'
export function statementParams(sp: Record<string, string | undefined>) {
  const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  return {
    from: d(sp.from), to: d(sp.to), project: sp.project && /^[0-9a-f-]{36}$/i.test(sp.project) ? sp.project : undefined,
    status: ['open', 'paid', 'overdue'].includes(sp.status ?? '') ? sp.status : undefined,
    /** full = statement of account (every invoice, payment and credit note); unpaid = only invoices still owed */
    type: (sp.type === 'unpaid' ? 'unpaid' : 'full') as StatementType,
  }
}
export const statementQuery = (f: { from?: string; to?: string; project?: string; type?: StatementType }) =>
  new URLSearchParams(Object.entries({ ...f, type: f.type === 'unpaid' ? 'unpaid' : undefined }).filter(([, v]) => v) as [string, string][]).toString()
