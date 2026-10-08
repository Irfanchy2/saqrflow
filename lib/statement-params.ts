/** Statement / ledger filters from the URL: date-only strings (YYYY-MM-DD) are used as-is — no UTC conversion. */
export function statementParams(sp: Record<string, string | undefined>) {
  const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  return { from: d(sp.from), to: d(sp.to), project: sp.project && /^[0-9a-f-]{36}$/i.test(sp.project) ? sp.project : undefined, status: ['open', 'paid', 'overdue'].includes(sp.status ?? '') ? sp.status : undefined }
}
export const statementQuery = (f: { from?: string; to?: string; project?: string }) => new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString()
