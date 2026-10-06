import 'server-only'
import { z } from 'zod'
import type { Ctx } from './auth'
import { str } from './action'

const opt = (max: number) => z.string().max(max).optional()
export const partySchema = z.object({
  name: z.string().min(2, 'Name is required').max(200),
  contact_person: opt(120),
  phone: z.string().max(40).optional().refine(v => !v || /^[+\d][\d\s()-]{5,}$/.test(v), 'Enter a valid phone number'),
  whatsapp: z.string().max(40).optional().refine(v => !v || /^[+\d][\d\s()-]{5,}$/.test(v), 'Enter a valid WhatsApp number'),
  email: z.string().email('Enter a valid email').optional(),
  trn: z.string().max(30).optional().refine(v => !v || /^\d{15}$/.test(v.replace(/\s|-/g, '')), 'A UAE TRN has 15 digits').transform(v => v?.replace(/\s|-/g, '')),
  address: opt(500), notes: opt(2000),
  credit_days: z.coerce.number().int('Whole days').min(0).max(365).optional(),
  opening_balance: z.coerce.number().min(-1e10).max(1e10).optional(),
  opening_balance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').optional(),
})
export const PARTY_KEYS = ['name', 'contact_person', 'phone', 'whatsapp', 'email', 'trn', 'address', 'notes', 'credit_days', 'opening_balance', 'opening_balance_date'] as const
export const readParty = (fd: FormData) => partySchema.safeParse(Object.fromEntries(PARTY_KEYS.map(k => [k, str(fd, k)])))

const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '').replace(/^(00|\+)?971/, '').replace(/^0/, '')
const norm = (s: string) => s.toLowerCase().replace(/\b(llc|l\.l\.c|fze|fzc|co|company|est|establishment|trading|contracting|general)\b\.?/g, '').replace(/[^a-z0-9؀-ۿ]+/g, '')

/**
 * Possible duplicates by company name (normalised: "ABC Contracting L.L.C." ≈ "abc contracting llc"), phone, email or TRN.
 * Only a warning — the user can still save a legitimately different customer with a similar name.
 */
export async function findDuplicates(c: Ctx, table: 'customers' | 'suppliers', v: { name: string; phone?: string; email?: string; trn?: string }, exceptId?: string) {
  const first = v.name.trim().split(/\s+/)[0]?.replace(/[%_,()]/g, '') ?? ''
  const ors = [`name.ilike.%${first}%`]
  if (v.email) ors.push(`email.ilike.${v.email.replace(/[%_,()]/g, '')}`)
  if (v.trn) ors.push(`trn.eq.${v.trn}`)
  const d = digits(v.phone); if (d.length >= 7) ors.push(`phone.ilike.%${d.slice(-7)}%`)
  const { data } = await c.supabase.from(table).select('id,name,phone,email,trn').or(ors.join(',')).limit(50)
  const n = norm(v.name)
  return (data ?? []).filter(r => r.id !== exceptId).map(r => {
    const why: string[] = []
    if (n && (norm(r.name) === n || (n.length >= 5 && (norm(r.name).includes(n) || n.includes(norm(r.name)))))) why.push('similar name')
    if (d.length >= 7 && digits(r.phone) && digits(r.phone).endsWith(d.slice(-9))) why.push('same phone')
    if (v.email && r.email?.toLowerCase() === v.email.toLowerCase()) why.push('same email')
    if (v.trn && r.trn === v.trn) why.push('same TRN')
    return { ...r, why }
  }).filter(r => r.why.length).slice(0, 5)
}
