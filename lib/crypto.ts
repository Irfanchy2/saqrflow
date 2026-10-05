import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function key(): Buffer {
  const b64 = process.env.SETTINGS_ENCRYPTION_KEY
  const k = b64 ? Buffer.from(b64, 'base64') : Buffer.alloc(0)
  if (k.length !== 32) throw new Error('SETTINGS_ENCRYPTION_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)')
  return k
}
/** AES-256-GCM → "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv, c.getAuthTag(), ct].map(p => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}
export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split('.')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported secret format')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}
export function hmacSha256Hex(secret: string, body: string | Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
