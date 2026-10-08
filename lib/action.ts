import 'server-only'
import { ZodError } from 'zod'
import { ForbiddenError } from './permissions'
import type { ActionState } from './utils'

/** Wraps a server action body: converts validation / permission / DB errors into friendly messages. */
export async function safe(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try { return (await fn()) ?? { ok: true } }
  catch (e) {
    const digest: string = (e as any)?.digest ?? ''
    // an expired session inside an action must not navigate away (unsaved work on screen would be lost)
    if (digest.startsWith('NEXT_REDIRECT') && digest.includes(';/login;')) return { error: 'Your session has expired. Sign in again in a new tab, then retry. Your changes are still on this screen.', data: { auth: true } }
    if (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND')) throw e
    if (e instanceof ZodError) return { error: e.issues.map(i => `${i.path.join('.') || 'Form'}: ${i.message}`).join(' · ') }
    if (e instanceof ForbiddenError) return { error: e.message }
    const m = (e as { message?: string; code?: string }) ?? {}
    if (m.code === '42501' || /row-level security|insufficient privilege/i.test(m.message ?? '')) return { error: 'You are not allowed to do that.' }
    if (m.code === '23505') return { error: 'A record with the same unique value already exists.' }
    if (m.code === '23514') return { error: 'One of the values is not allowed (check dates, amounts and statuses).' }
    if (m.code === '23503') return { error: 'This record is still referenced by other data.' }
    if (m.code === 'P0409' || /conflict:/.test(m.message ?? '')) return { error: 'Someone else changed this record. Reload to see the latest version.' }
    if (/fetch failed|network|ECONN|ETIMEDOUT/i.test(m.message ?? '')) return { error: 'The server could not reach the database. Please try again in a moment.' }
    console.error('[action]', e)   // technical detail stays in the server log
    const msg = m.message ?? ''
    return { error: msg && msg.length < 200 && !/^\s*(select|insert|update|delete)|relation|column|violates|syntax|function|undefined|null value|\bat\b.*\(/i.test(msg) ? msg : 'Something went wrong. Please try again. If it keeps happening, contact your administrator.' }
  }
}
export const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined }
