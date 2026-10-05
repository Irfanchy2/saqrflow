import 'server-only'
import { ZodError } from 'zod'
import { ForbiddenError } from './permissions'
import type { ActionState } from './utils'

/** Wraps a server action body: converts validation / permission / DB errors into friendly messages. */
export async function safe(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try { return (await fn()) ?? { ok: true } }
  catch (e) {
    if ((e as any)?.digest?.startsWith?.('NEXT_REDIRECT')) throw e
    if (e instanceof ZodError) return { error: e.issues.map(i => `${i.path.join('.') || 'Form'}: ${i.message}`).join(' · ') }
    if (e instanceof ForbiddenError) return { error: e.message }
    const m = (e as { message?: string; code?: string }) ?? {}
    if (m.code === '42501' || /row-level security|insufficient privilege/i.test(m.message ?? '')) return { error: 'You are not allowed to do that.' }
    if (m.code === '23505') return { error: 'A record with the same unique value already exists.' }
    if (m.code === '23514') return { error: 'One of the values is not allowed (check dates, amounts and statuses).' }
    if (m.code === '23503') return { error: 'This record is still referenced by other data.' }
    console.error('[action]', e)
    return { error: m.message && !/^\s*(select|insert|update)/i.test(m.message) ? m.message : 'Something went wrong. Please try again.' }
  }
}
export const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined }
