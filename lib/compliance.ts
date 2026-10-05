import { effectiveStatus } from './documents'
export const REQUIRED_EMPLOYEE_DOCS = ['Passport', 'Emirates ID', 'Residence Visa', 'Work Permit', 'Labour Contract', 'Medical Insurance'] as const
export type ChecklistState = 'missing' | 'valid' | 'expiring_soon' | 'expired' | 'no_expiry' | 'renewal_in_progress' | 'cancelled'

/** For each required category: best (latest-expiring) document → state. Also returns a 0–100 completeness score. */
export function employeeChecklist(docs: { category_name?: string | null; expiry_date?: string | null; status?: string | null }[], today: string) {
  const items = REQUIRED_EMPLOYEE_DOCS.map(name => {
    const mine = docs.filter(d => d.category_name === name).sort((a, b) => (b.expiry_date ?? '9999').localeCompare(a.expiry_date ?? '9999'))
    return { name, state: (mine[0] ? effectiveStatus(mine[0], today) : 'missing') as ChecklistState, expiry: mine[0]?.expiry_date ?? null }
  })
  const ok = items.filter(i => ['valid', 'no_expiry', 'expiring_soon', 'renewal_in_progress'].includes(i.state)).length
  return { items, score: Math.round((ok / items.length) * 100), issues: items.filter(i => i.state === 'missing' || i.state === 'expired').length }
}
