// Matching engines: pure functions so they can be unit-tested. Never creates records.

const ALIASES: Record<string, string> = { mohammad: 'mohammed', muhammad: 'mohammed', mohamed: 'mohammed', mohamad: 'mohammed', mohd: 'mohammed', md: 'mohammed', mohammod: 'mohammed', ahamed: 'ahmed', ahmad: 'ahmed' }
const STOP = new Set(['al', 'el', 'bin', 'bint', 'ibn', 'mr', 'mrs', 'ms', 'llc', 'l', 'c', 'fze', 'fzco', 'fz', 'est', 'co', 'company', 'and', 'the', 'trading', 'establishment', 'llc.'])
export const nameTokens = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).map(t => ALIASES[t] ?? t)
const meaningful = (s: string) => nameTokens(s).filter(t => !STOP.has(t) && t.length > 1)
export const normId = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** 0..1 similarity of two person names (order-insensitive, alias-aware). */
export function nameScore(a: string, b: string): number {
  const x = new Set(meaningful(a)), y = new Set(meaningful(b))
  if (!x.size || !y.size) return 0
  const inter = [...x].filter(t => y.has(t)).length
  if (inter === x.size && inter === y.size) return 0.97
  const smaller = Math.min(x.size, y.size)
  if (inter === smaller && smaller >= 2) return 0.9            // "Mohammed Ayub" ⊂ "Mohammed Ayub Khan"
  if (inter >= 2) return 0.75
  if (inter === 1 && smaller === 1) return 0.6
  return inter ? 0.35 : 0
}

export interface EmployeeCandidate { id: string; full_name: string; employee_no: string; phone?: string | null; idNumbers: string[] }
export interface Match { id: string; name: string; confidence: number; reason: string }

export function matchEmployee(input: { holderName?: string; documentNumber?: string; text: string }, employees: EmployeeCandidate[]): Match[] {
  const text = input.text.toUpperCase(), textIds = normId(input.text)
  const docNo = input.documentNumber ? normId(input.documentNumber) : ''
  const out: Match[] = []
  for (const e of employees) {
    let best = 0, reason = ''
    const bump = (c: number, r: string) => { if (c > best) { best = c; reason = r } }
    for (const n of e.idNumbers.map(normId).filter(n => n.length >= 6)) {
      if (docNo && n === docNo) bump(0.99, 'Same document number as a document already on file')
      else if (textIds.includes(n)) bump(0.97, 'An ID number on file appears in this document')
    }
    if (e.employee_no && new RegExp(`\\b${e.employee_no.replace(/[^A-Za-z0-9-]/g, '')}\\b`, 'i').test(text) && e.employee_no.length >= 3) bump(0.9, 'Employee ID found in document')
    if (input.holderName) { const s = nameScore(input.holderName, e.full_name); bump(s, s >= 0.97 ? 'Name matches exactly' : 'Name partially matches') }
    else { const s = nameScore(input.text.slice(0, 3000), e.full_name); if (s >= 0.9) bump(Math.min(0.85, s), 'Name found in document text') }
    if (e.phone && e.phone.length > 8 && textIds.includes(normId(e.phone).slice(-9))) bump(Math.max(best, 0.8), 'Phone number matches')
    if (best >= 0.5) out.push({ id: e.id, name: e.full_name, confidence: Math.round(best * 100) / 100, reason })
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 5)
}

/** 0..1: does the company named on the document look like this company? */
export function companyScore(docName: string, names: string[]): number {
  const d = new Set(meaningful(docName)); if (!d.size) return 0
  let best = 0
  for (const n of names.filter(Boolean)) {
    const c = new Set(meaningful(n)); if (!c.size) continue
    const inter = [...c].filter(t => d.has(t)).length
    const distinctive = [...c].some(t => t.length >= 4 && d.has(t))                     // e.g. "saqr" in both names
    best = Math.max(best, inter === c.size ? (inter === d.size ? 0.99 : 0.9) : distinctive ? Math.max(0.75, inter / c.size * 0.8) : inter / c.size * 0.8)
  }
  return Math.round(best * 100) / 100
}

export function matchByName<T extends { id: string; name: string }>(name: string | undefined, rows: T[]): Match[] {
  if (!name) return []
  return rows.map(r => ({ id: r.id, name: r.name, confidence: Math.max(companyScore(name, [r.name]), nameScore(name, r.name)), reason: 'Name matches' }))
    .filter(m => m.confidence >= 0.5).sort((a, b) => b.confidence - a.confidence).slice(0, 5)
}
