import 'server-only'
import type { Ctx } from './auth'

export type CompanyCard = { id: string; label: string; last4: string; kind: string; active: boolean }
export const CARD_KINDS: Record<string, string> = { credit: 'Credit card', debit: 'Debit card', prepaid: 'Prepaid card' }
/** "Credit card ••9865" */
export const cardName = (k: { label: string; last4: string }) => `${k.label} ••${k.last4}`

/** The company's cards (Settings → Company cards). Active ones only unless `all`. Only the last four digits are stored. */
export async function companyCards(c: Ctx, all = false): Promise<CompanyCard[]> {
  let q = c.supabase.from('company_cards').select('id,label,last4,kind,active').order('active', { ascending: false }).order('label')
  if (!all) q = q.eq('active', true)
  const { data } = await q
  return (data ?? []) as CompanyCard[]
}
