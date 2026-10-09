'use server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptSecret } from '@/lib/crypto'
import { parseOffsets } from '@/lib/reminders/schedule'
import { ROLES, type Role } from '@/lib/permissions'
import { LOCALES } from '@/lib/i18n'
import type { ActionState } from '@/lib/utils'
import { findDuplicates, readParty } from '@/lib/parties'

async function setting(c: Awaited<ReturnType<typeof getCtx>>, key: string, value: unknown) {
  // app_settings.value is NOT NULL: "not set" is stored as false (readers check the type, so false reads as unset)
  const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key, value: value ?? false, updated_at: new Date().toISOString() }); if (error) throw error
}

export async function saveCompany(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const v = z.object({ name: z.string().min(2).max(200), trade_name: z.string().max(200).optional() }).parse({ name: str(fd, 'name'), trade_name: str(fd, 'trade_name') })
    const { error } = await c.supabase.from('companies').update(v).eq('id', c.company.id); if (error) throw error
    revalidatePath('/', 'layout'); return { ok: true, message: 'Saved.' }
  })
}
export async function saveReminderSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const offs = parseOffsets(str(fd, 'offsets') ?? ''); if (!offs.length) return { error: 'Enter at least one reminder day (e.g. 90, 60, 30, 15, 7, 3, 1, 0).' }
    const n = z.object({ every: z.coerce.number().int().min(0).max(90), max: z.coerce.number().int().min(0).max(52), hour: z.coerce.number().int().min(0).max(23) }).parse({ every: str(fd, 'overdue_every'), max: str(fd, 'overdue_max'), hour: str(fd, 'digest_hour') })
    await Promise.all([
      setting(c, 'reminders.offsets', offs), setting(c, 'reminders.overdue_every_days', n.every), setting(c, 'reminders.overdue_max', n.max),
      setting(c, 'reminders.digest_hour', n.hour), setting(c, 'reminders.digest_enabled', fd.get('digest') === 'on'), setting(c, 'reminders.email_fallback', fd.get('fallback') === 'on'),
    ])
    revalidatePath('/settings'); return { ok: true, message: 'Reminder settings saved.' }
  })
}
export async function saveWhatsApp(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const pid = str(fd, 'phone_number_id'); if (pid && !/^\d{5,20}$/.test(pid)) return { error: 'Phone number ID should be digits only (from Meta → WhatsApp → API setup).' }
    const waba = str(fd, 'waba_id'); if (waba && !/^\d{5,20}$/.test(waba)) return { error: 'WhatsApp Business Account ID should be digits only.' }
    const appId = str(fd, 'app_id'); if (appId && !/^\d{5,20}$/.test(appId)) return { error: 'Meta App ID should be digits only (Meta for Developers → your app).' }
    const cost = str(fd, 'cost'); const costN = cost ? z.coerce.number().min(0).max(100).parse(cost) : null
    await Promise.all([setting(c, 'whatsapp.phone_number_id', pid ?? null), setting(c, 'whatsapp.waba_id', waba ?? null), setting(c, 'whatsapp.app_id', appId ?? null), setting(c, 'whatsapp.mode', fd.get('sandbox') === 'on' ? 'sandbox' : 'auto'), setting(c, 'whatsapp.cost_per_message', costN)])
    const token = str(fd, 'token')
    if (token) {
      if (!process.env.SETTINGS_ENCRYPTION_KEY) return { error: 'Cannot store the token: SETTINGS_ENCRYPTION_KEY is not set on the server. Set it, or provide WHATSAPP_ACCESS_TOKEN as an environment variable instead.' }
      const { error } = await createAdminClient().from('integration_secrets').upsert({ company_id: c.company.id, name: 'whatsapp_token', ciphertext: encryptSecret(token), updated_at: new Date().toISOString() }); if (error) throw error
    }
    revalidatePath('/settings'); revalidatePath('/reminders'); return { ok: true, message: token ? 'Saved. The token is encrypted and can never be displayed again.' : 'Saved.' }
  })
}
export async function clearWhatsAppToken(): Promise<ActionState> {
  return safe(async () => { const c = await getCtx(); need(c, 'settings.manage'); await createAdminClient().from('integration_secrets').delete().eq('company_id', c.company.id).eq('name', 'whatsapp_token'); revalidatePath('/settings'); return { ok: true, message: 'Stored token removed.' } })
}
export async function setLocale(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); const l = z.enum(LOCALES).parse(str(fd, 'locale'))
    await c.supabase.from('profiles').update({ locale: l }).eq('id', c.userId)
    ;(await cookies()).set('sf-locale', l, { path: '/', maxAge: 31536000, sameSite: 'lax' })
    revalidatePath('/', 'layout'); return { ok: true, message: 'Language updated.' }
  })
}

// ── users ──
const roleEnum = z.enum(ROLES)
async function ownersLeft(c: Awaited<ReturnType<typeof getCtx>>, exceptId: string) {
  const { count } = await c.supabase.from('profiles').select('id', { count: 'exact', head: true }).in('role', ['company_owner', 'super_admin']).eq('is_active', true).neq('id', exceptId); return count ?? 0
}
export async function inviteUser(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'users.manage')
    const v = z.object({ email: z.string().email('Enter a valid email'), name: z.string().min(2, 'Enter a name').max(120), role: roleEnum }).parse({ email: str(fd, 'email'), name: str(fd, 'name'), role: str(fd, 'role') })
    if (v.role === 'super_admin' && c.profile.role !== 'super_admin') return { error: 'Only a Super Admin can create another Super Admin.' }
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback` })
    if (error || !data.user) return { error: error?.message?.includes('registered') ? 'That email already has an account.' : 'Could not send the invitation.' }
    const { error: e2 } = await admin.from('profiles').insert({ id: data.user.id, company_id: c.company.id, full_name: v.name, role: v.role }); if (e2) throw e2
    revalidatePath('/users'); return { ok: true, message: `Invitation sent to ${v.email}.` }
  })
}
export async function changeRole(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'users.manage'); const role = roleEnum.parse(str(fd, 'role')) as Role
    if (!['company_owner', 'super_admin'].includes(role) && (await ownersLeft(c, id)) < 1) return { error: 'The company must keep at least one owner.' }
    const { data, error } = await c.supabase.from('profiles').update({ role }).eq('id', id).select('id'); if (error) throw error
    if (!data?.length) return { error: 'User not found.' }
    revalidatePath('/users'); return { ok: true, message: 'Role updated.' }
  })
}
export async function setUserActive(id: string, active: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'users.manage')
    if (!active && (id === c.userId || (await ownersLeft(c, id)) < 1)) return { error: id === c.userId ? 'You cannot deactivate your own account.' : 'The company must keep at least one active owner.' }
    const { error } = await c.supabase.from('profiles').update({ is_active: active }).eq('id', id); if (error) throw error
    revalidatePath('/users'); return { ok: true }
  })
}
export async function createParty(kind: 'customers' | 'suppliers', _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const table = z.enum(['customers', 'suppliers']).parse(kind)
    const r = readParty(fd)
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: Object.fromEntries(r.error.issues.map(i => [i.path.join('.'), i.message])) }
    const v = r.data
    // possible duplicates are shown, never silently blocked — the user confirms a legitimately different customer
    if (fd.get('confirm_duplicate') !== 'on') {
      const dups = await findDuplicates(c, table, v)
      if (dups.length) return { error: `Possible duplicate: ${dups.map(d => `“${d.name}” (${d.why.join(', ')})`).join('; ')}. Open the existing record, or tick “This is a different ${table === 'customers' ? 'customer' : 'supplier'}” and save again.`, data: { duplicates: dups } }
    }
    const row: Record<string, unknown> = { ...v, company_id: c.company.id }
    if (table === 'suppliers') { delete row.credit_days; delete row.opening_balance; delete row.opening_balance_date } else row.created_by = c.userId
    const { data, error } = await c.supabase.from(table).insert(row).select('id').single()
    if (error) { if (error.code === '23505') return { error: `A ${table === 'customers' ? 'customer' : 'supplier'} named “${v.name}” already exists (it may be in the trash: Settings → Trash).` }; throw error }
    revalidatePath('/parties'); return { ok: true, message: 'Saved.', data: { id: data.id } }
  })
}
