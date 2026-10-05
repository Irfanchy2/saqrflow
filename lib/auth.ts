import 'server-only'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from './supabase/server'
import { can, ForbiddenError, type Permission, type Role } from './permissions'
import { todayInTz } from './time'

export interface Ctx {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string; email: string
  profile: { id: string; company_id: string; full_name: string; role: Role; locale: string }
  company: { id: string; name: string; timezone: string; currency: string; locale: string }
  today: string
  can: (p: Permission) => boolean
}

/** Loads the signed-in user, profile, company. Redirects to login/onboarding as needed. Cached per request. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('id, company_id, full_name, role, locale').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/onboarding')
  const { data: company } = await supabase.from('companies').select('id, name, timezone, currency, locale').eq('id', profile.company_id).single()
  if (!company) redirect('/onboarding')
  const role = profile.role as Role
  return { supabase, userId: user.id, email: user.email ?? '', profile: { ...profile, role }, company, today: todayInTz(new Date(), company.timezone), can: p => can(role, p) }
})

/** Server-action guard: throws (turned into a friendly message by `safe`) when the role lacks the permission. The DB re-checks via RLS. */
export function need(ctx: Ctx, perm: Permission) { if (!ctx.can(perm)) throw new ForbiddenError(perm) }
