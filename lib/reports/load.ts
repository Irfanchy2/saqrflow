import 'server-only'
import type { Ctx } from '../auth'
import { resolvePeriod, type Period } from './period'
import { SECTIONS, type SectionKey } from './sections'

/** One aggregation call (report_summary, SECURITY INVOKER → RLS) per page view or export; nothing is summed in the browser. */
export async function loadReport(c: Ctx, sp: Record<string, string | undefined>): Promise<{ period: Period; data: Record<string, any> }> {
  const period = resolvePeriod(sp, c.today)
  const { data, error } = await c.supabase.rpc('report_summary', { p_from: period.from, p_to: period.to, p_today: c.today })
  if (error) throw error
  return { period, data: (data ?? {}) as Record<string, any> }
}
/** Sections this user may open: finance sections need finance.view (the database enforces the same through RLS). */
export const allowedSections = (c: Ctx) => SECTIONS.filter(([, , need]) => need === 'any' || c.can('finance.view')).map(([k]) => k as SectionKey)
