'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'
import { checkNewDevice, logLogin, recentFailedSignIns, requestMeta } from '@/lib/sessions'
import { sessionIdFromJwt } from '@/lib/device'
import { createAdminClient } from '@/lib/supabase/admin'
import { alertAdmins, passwordProblem, rateLimit, securityEvent } from '@/lib/security'
import { DEMO_EMAIL, DEMO_PASSWORD, isDemoEmail, repairDemoAuth } from '@/lib/demo'

const safeNext = (n?: string) => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/')
const LOCK_AFTER = 5   // failed sign-ins for one email within 15 minutes

export async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const v = z.object({ email: z.string().email('Enter a valid email').max(320), password: z.string().min(1, 'Enter your password').max(256) }).parse({ email: str(fd, 'email')?.toLowerCase(), password: fd.get('password') })
    // brute-force protection shared by all server instances: per network, then per account
    const { ip } = await requestMeta()
    if (!(await rateLimit(`signin:ip:${ip ?? 'unknown'}`, 100, 900))) {
      await securityEvent('rate_limited', { detail: `sign-in attempts from ${ip ?? 'unknown'}` })
      return { error: 'Too many sign-in attempts from this network. Wait 15 minutes and try again.' }
    }
    const demo = isDemoEmail(v.email)   // the shared demo: its password is public, so no lockout (a stranger could otherwise lock everyone out)
    if (!demo && (await recentFailedSignIns(v.email)) >= LOCK_AFTER) {
      await logLogin('sign_in_locked', { email: v.email, detail: `${LOCK_AFTER}+ failed attempts in 15 minutes` })
      return { error: 'This account is locked for 15 minutes after repeated failed sign-ins. Wait, or reset your password.' }
    }
    const sb = await createClient()
    let { data: signed, error } = await sb.auth.signInWithPassword(v)
    if (error && demo && v.password === DEMO_PASSWORD) {   // a visitor changed the demo sign-in: put it back, then try again
      await repairDemoAuth(); ({ data: signed, error } = await sb.auth.signInWithPassword(v))
    }
    if (error) {
      const who = await logLogin('sign_in_failed', { email: v.email })       // same message for an unknown user and a wrong password
      if ((await recentFailedSignIns(v.email)) >= LOCK_AFTER && who.companyId) {
        await securityEvent('sign_in_locked', { companyId: who.companyId, userId: who.userId, detail: `${v.email}: ${LOCK_AFTER} failed sign-ins in 15 minutes` })
        await alertAdmins(who.companyId, { title: 'Repeated failed sign-ins', body: `${v.email} was locked for 15 minutes after ${LOCK_AFTER} failed attempts${ip ? ` (from ${ip})` : ''}.`, throttleKey: `lock:${v.email}`, severity: 'warning' })
      }
      return { error: 'Incorrect email or password.' }
    }
    const sid = sessionIdFromJwt(signed.session?.access_token)
    const who = await logLogin('sign_in', { userId: signed.user?.id, email: v.email, sessionId: sid })
    if (who.userId && who.companyId && !demo) await checkNewDevice(who.userId, who.companyId, v.email, sid)
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
    if (demo && aal?.nextLevel === 'aal2') { await repairDemoAuth(); redirect('/') }   // a visitor turned on two-step for the shared demo
    redirect(aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2' ? '/login/mfa' : safeNext(str(fd, 'next')))
  })
}
/** "Try the demo": signs in to the shared demo company (repairing its sign-in first if a visitor changed it). */
export async function signInDemo(_?: ActionState, __?: FormData): Promise<ActionState> {
  const fd = new FormData(); fd.set('email', DEMO_EMAIL); fd.set('password', DEMO_PASSWORD); fd.set('next', '/')
  return signIn({}, fd)
}
export async function verifyMfa(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const sb = await createClient()
    const { data: { user: me } } = await sb.auth.getUser(); if (!me) redirect('/login')
    if (!(await rateLimit(`mfa:${me.id}`, 5, 300))) return { error: 'Too many codes tried. Wait 5 minutes, then enter the current code from your app.' }
    const { data: f } = await sb.auth.mfa.listFactors()
    const factor = f?.totp.find(x => x.status === 'verified'); if (!factor) return { error: 'No authenticator is enrolled.' }
    const ch = await sb.auth.mfa.challenge({ factorId: factor.id }); if (ch.error) return { error: ch.error.message }
    const v = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data.id, code: String(fd.get('code') ?? '').replace(/\s/g, '') })
    const { data: { user } } = await sb.auth.getUser()
    if (v.error) { await logLogin('mfa_failed', { userId: user?.id, email: user?.email }); return { error: 'That code is not valid. Try again.' } }
    await logLogin('mfa_verified', { userId: user?.id, email: user?.email, sessionId: sessionIdFromJwt(v.data?.access_token) })
    redirect('/')
  })
}
export async function signUp(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const v = z.object({ email: z.string().email('Enter a valid email').max(320), password: z.string().max(256) }).parse({ email: str(fd, 'email')?.toLowerCase(), password: fd.get('password') })
    const weak = passwordProblem(v.password, v.email); if (weak) return { error: weak, fieldErrors: { password: weak } }
    const { ip } = await requestMeta()
    if (!(await rateLimit(`signup:ip:${ip ?? 'unknown'}`, 60, 3600))) return { error: 'Too many new accounts from this network. Try again later.' }
    const sb = await createClient()
    const { data, error } = await sb.auth.signUp({ ...v, options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback` } })
    // the same answer whether or not the email already has an account (no account discovery through sign-up)
    if (error) return /registered|exists/i.test(error.message) ? { ok: true, message: 'Check your inbox to confirm your email, then sign in.' } : { error: 'Could not create the account. Check the details and try again.' }
    if (data.session) redirect('/onboarding')
    return { ok: true, message: 'Check your inbox to confirm your email, then sign in.' }
  })
}
export async function createCompany(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const v = z.object({ company: z.string().min(2, 'Company name is too short').max(200), name: z.string().min(2, 'Enter your name').max(120) }).parse({ company: str(fd, 'company'), name: str(fd, 'name') })
    const { error } = await (await createClient()).rpc('create_company_with_owner', { p_company_name: v.company, p_full_name: v.name })
    if (error) return { error: error.message.includes('already') ? 'Your account already has a company.' : 'Could not create the company.' }
    redirect('/')
  })
}
export async function signOut(fd?: FormData) {
  const sb = await createClient()
  const [{ data: { user } }, { data: { session } }] = await Promise.all([sb.auth.getUser(), sb.auth.getSession()])
  const sid = sessionIdFromJwt(session?.access_token)
  if (user) {
    await logLogin('sign_out', { userId: user.id, email: user.email, sessionId: sid })
    if (sid) { try { await createAdminClient().from('user_sessions').update({ revoked_at: new Date().toISOString(), revoked_by: user.id }).eq('id', sid).eq('user_id', user.id).is('revoked_at', null) } catch {} }
  }
  await sb.auth.signOut(); redirect(fd instanceof FormData && fd.get('next') === 'signup' ? '/signup' : '/login')
}

/** Forgot password: always the same answer (it never reveals whether the email has an account). Rate-limited. */
export async function requestPasswordReset(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const email = z.string().email('Enter a valid email').max(320).parse(str(fd, 'email')?.toLowerCase())
    const done = { ok: true, message: 'If an account uses this email, a reset link is on its way. It works once and expires within an hour.' }
    if (isDemoEmail(email)) return { ok: true, message: `The shared demo has no reset: its password is always ${DEMO_PASSWORD}.` }
    const { ip } = await requestMeta()
    if (!(await rateLimit(`reset:ip:${ip ?? 'unknown'}`, 10, 3600)) || !(await rateLimit(`reset:email:${email}`, 3, 3600))) return done
    const sb = await createClient()
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback?next=/login/reset` })
    if (error) console.warn('[password-reset]', error.message)
    await logLogin('password_reset_requested', { email })
    return done
  })
}
/** Sets a new password for the signed-in user (after a reset link), then signs out every other device. */
export async function resetPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const sb = await createClient()
    const { data: { user } } = await sb.auth.getUser(); if (!user) return { error: 'The reset link has expired. Request a new one.' }
    if (isDemoEmail(user.email)) return { error: 'The shared demo password cannot be changed.' }
    const pw = String(fd.get('password') ?? ''), again = String(fd.get('confirm') ?? '')
    const weak = passwordProblem(pw, user.email); if (weak) return { error: weak, fieldErrors: { password: weak } }
    if (pw !== again) return { error: 'The two passwords do not match.', fieldErrors: { confirm: 'Does not match' } }
    const { error } = await sb.auth.updateUser({ password: pw })
    if (error) return { error: /same|different/i.test(error.message) ? 'Choose a password you have not used before.' : 'Could not change the password. Request a new reset link and try again.' }
    const sid = sessionIdFromJwt((await sb.auth.getSession()).data.session?.access_token)
    await sb.auth.signOut({ scope: 'others' }).catch(() => {})
    await sb.rpc('revoke_other_sessions', { p_keep: sid, p_user: null }).then(() => {}, () => {})
    await logLogin('password_changed', { userId: user.id, email: user.email, sessionId: sid })
    redirect('/?m=password-changed')
  })
}
