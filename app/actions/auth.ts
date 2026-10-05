'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

const cred = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(10, 'Use at least 10 characters') })
const safeNext = (n?: string) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/')

export async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const v = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') }).parse({ email: str(fd, 'email'), password: fd.get('password') })
    const sb = await createClient()
    const { error } = await sb.auth.signInWithPassword(v)
    if (error) return { error: 'Incorrect email or password.' }       // same message for unknown user / wrong password
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
    redirect(aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2' ? '/login/mfa' : safeNext(str(fd, 'next')))
  })
}
export async function verifyMfa(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const sb = await createClient()
    const { data: f } = await sb.auth.mfa.listFactors()
    const factor = f?.totp.find(x => x.status === 'verified'); if (!factor) return { error: 'No authenticator is enrolled.' }
    const ch = await sb.auth.mfa.challenge({ factorId: factor.id }); if (ch.error) return { error: ch.error.message }
    const v = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data.id, code: String(fd.get('code') ?? '').replace(/\s/g, '') })
    if (v.error) return { error: 'That code is not valid. Try again.' }
    redirect('/')
  })
}
export async function signUp(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const v = cred.parse({ email: str(fd, 'email'), password: fd.get('password') })
    const sb = await createClient()
    const { data, error } = await sb.auth.signUp({ ...v, options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback` } })
    if (error) return { error: error.message }
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
export async function signOut() { await (await createClient()).auth.signOut(); redirect('/login') }
