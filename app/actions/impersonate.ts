'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx } from '@/lib/auth'
import { safe } from '@/lib/action'
import { ForbiddenError } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/security'
import { clearImpersonation, readImpersonation, setImpersonation } from '@/lib/impersonation'
import type { ActionState } from '@/lib/utils'

// "Log in as employee" (Employees → open a person → Portal access). Only someone who manages users (owners), only for an
// active Employee login of the same company: never another admin, owner or manager, never themselves. The owner's own
// session is kept encrypted (lib/impersonation) and restored by "Back to admin". Start and end go to the audit log.

const audit = (companyId: string, userId: string, action: 'IMPERSONATE_START' | 'IMPERSONATE_END', employeeId: string, changes: Record<string, unknown>) =>
  createAdminClient().from('audit_logs').insert({ company_id: companyId, user_id: userId, action, table_name: 'employees', record_id: employeeId, changes }).then(() => {}, () => {})

export async function loginAsEmployee(employeeId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    if (!c.can('users.manage')) throw new ForbiddenError('users.manage')
    if (!z.string().uuid().safeParse(employeeId).success) return { error: 'Employee not found.' }
    if (await readImpersonation()) return { error: 'You are already viewing an employee portal. Use “Back to admin” first.' }
    if (!(await rateLimit(`impersonate:${c.userId}`, 30, 3600))) return { error: 'Too many switches in the last hour. Please try again later.' }
    const { data: e } = await c.supabase.from('employees').select('id,full_name,user_id,company_id').eq('id', employeeId).maybeSingle()
    if (!e || e.company_id !== c.company.id) return { error: 'Employee not found.' }
    if (!e.user_id) return { error: `${e.full_name} has no portal login yet. Give portal access first.` }
    if (e.user_id === c.userId) return { error: 'This is your own login.' }
    const admin = createAdminClient()
    const { data: prof } = await admin.from('profiles').select('role,is_active,company_id').eq('id', e.user_id).maybeSingle()
    if (!prof || prof.company_id !== c.company.id || prof.role !== 'employee' || !prof.is_active)
      return { error: 'Only an active Employee portal login can be opened this way (never an admin or manager login).' }
    const { data: u } = await admin.auth.admin.getUserById(e.user_id)
    if (!u?.user?.email) return { error: 'This employee login has no email address.' }

    const sb = await createClient()
    const { data: { session } } = await sb.auth.getSession()
    if (!session?.refresh_token) return { error: 'Your session has expired. Sign in again.' }
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
    const hash = link?.properties?.hashed_token
    if (le || !hash) return { error: 'The employee portal could not be opened. Please try again.' }

    // keep the owner's session first, then switch: a failure leaves the owner signed in as before
    await setImpersonation({ rt: session.refresh_token, adminId: c.userId, adminName: c.profile.full_name, employeeId: e.id, employeeName: e.full_name, companyId: c.company.id, startedAt: new Date().toISOString() })
    const { error: ve } = await sb.auth.verifyOtp({ type: 'magiclink', token_hash: hash })
    if (ve) { await clearImpersonation(); return { error: 'The employee portal could not be opened. Please try again.' } }
    await audit(c.company.id, c.userId, 'IMPERSONATE_START', e.id, { employee: e.full_name, login: e.user_id, by: c.profile.full_name })
    redirect('/me')
  })
}

/** Ends "view as employee": signs the employee session out and restores the owner's own session. */
export async function returnToAdmin(): Promise<void> {
  const st = await readImpersonation()
  const sb = await createClient()
  await sb.auth.signOut({ scope: 'local' }).catch(() => {})
  await clearImpersonation()
  if (!st) redirect('/login')
  const { error } = await sb.auth.refreshSession({ refresh_token: st.rt })
  if (error) redirect('/login')
  await audit(st.companyId, st.adminId, 'IMPERSONATE_END', st.employeeId, { employee: st.employeeName, minutes: Math.round((Date.now() - Date.parse(st.startedAt)) / 60000) })
  redirect(`/employees/${st.employeeId}`)
}
