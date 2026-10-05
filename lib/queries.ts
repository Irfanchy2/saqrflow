export const PAGE_SIZE = 15
/** Strip characters that have meaning inside PostgREST `or()` / ilike filters. */
export const sanitizeQ = (q?: string) => (q ?? '').replace(/[,()%*_\\"']/g, ' ').trim().slice(0, 80)
export const pageOf = (p?: string) => Math.max(1, Number.parseInt(p ?? '1', 10) || 1)
export type SP = Record<string, string | undefined>
export const flat = async (sp: Promise<Record<string, string | string[] | undefined>>): Promise<SP> =>
  Object.fromEntries(Object.entries(await sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
