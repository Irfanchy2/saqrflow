import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { supabaseSecretKey } from './env'

// "Log in as employee": an owner opens an employee's portal as that employee, then comes back. While switched, the
// owner's own session is kept in an encrypted, httpOnly cookie (never readable by the page, never sent anywhere else),
// so "Back to admin" restores it without asking for the password again. Every start and end is in the audit log.

export const IMP_COOKIE = 'averiqo-imp'
const MAX_AGE = 8 * 3600   // a switched session ends by itself after 8 hours (the owner signs in again)

export type Impersonation = { rt: string; adminId: string; adminName: string; employeeId: string; employeeName: string; companyId: string; startedAt: string }

function key(): Buffer {
  const base = process.env.SETTINGS_ENCRYPTION_KEY || supabaseSecretKey()
  return createHash('sha256').update(`averiqo-impersonation:${base}`).digest()
}
export function seal(v: Impersonation): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(JSON.stringify(v), 'utf8'), c.final()])
  return [iv, c.getAuthTag(), ct].map(b => b.toString('base64url')).join('.')
}
export function unseal(blob: string | undefined | null): Impersonation | null {
  try {
    const [iv, tag, ct] = (blob ?? '').split('.')
    if (!iv || !tag || !ct) return null
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'))
    const v = JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')) as Impersonation
    return Date.now() - Date.parse(v.startedAt) < MAX_AGE * 1000 ? v : null
  } catch { return null }
}

export async function setImpersonation(v: Impersonation) {
  (await cookies()).set(IMP_COOKIE, seal(v), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: MAX_AGE })
}
export async function readImpersonation(): Promise<Impersonation | null> {
  return unseal((await cookies()).get(IMP_COOKIE)?.value)
}
export async function clearImpersonation() {
  (await cookies()).delete(IMP_COOKIE)
}
