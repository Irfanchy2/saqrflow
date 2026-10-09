import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'

/**
 * Outbound requests to customer-supplied URLs (webhooks). Blocks private, loopback, link-local, CGNAT and metadata
 * addresses, and connects to the exact address that was checked (no second DNS lookup → no DNS-rebinding bypass).
 * WEBHOOK_ALLOW_PRIVATE=1 lifts the address check for local testing only; it is never set in production.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (v === 6) {
    const s = ip.toLowerCase()
    if (s === '::' || s === '::1') return true
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) return isPrivateAddress(mapped[1])
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('2001:db8')
  }
  return true
}

export const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === '1'   // local / CI test receivers only

/** Validates a webhook URL for saving: https (http only in local testing), no credentials, a public host. */
export function urlProblem(raw: string): string | null {
  let u: URL
  try { u = new URL(raw) } catch { return 'Enter a full URL, e.g. https://example.com/hooks/averiqo' }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowPrivate())) return 'Webhook URLs must start with https://'
  if (u.username || u.password) return 'Do not put a username or password in the URL. Verify the signature header instead.'
  if (raw.length > 500) return 'The URL is too long.'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!allowPrivate() && (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || (isIP(host) && isPrivateAddress(host)))) return 'Webhooks can only be sent to public internet addresses.'
  return null
}

export interface PostResult { status: number | null; ms: number; error?: string }

export async function postJson(url: string, body: string, headers: Record<string, string>, timeoutMs = 8000): Promise<PostResult> {
  const started = Date.now()
  const bad = urlProblem(url); if (bad) return { status: null, ms: 0, error: bad }
  const u = new URL(url), host = u.hostname.replace(/^\[|\]$/g, '')
  let address: string, family: number
  try {
    if (isIP(host)) { address = host; family = isIP(host) }
    else { const r = await lookup(host); address = r.address; family = r.family }
  } catch { return { status: null, ms: Date.now() - started, error: `Could not resolve ${host}` } }
  if (!allowPrivate() && isPrivateAddress(address)) return { status: null, ms: Date.now() - started, error: 'The URL resolves to a private network address' }
  const mod = u.protocol === 'https:' ? https : http
  return new Promise<PostResult>(resolve => {
    const req = mod.request(u, {
      method: 'POST', timeout: timeoutMs,
      headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'user-agent': 'Averiqo-Webhooks/1.0' },
      lookup: (_h: string, _o: unknown, cb: (e: Error | null, a: string, f: number) => void) => cb(null, address, family),   // pinned to the checked address
    } as https.RequestOptions, res => {
      res.resume()   // the response body is not needed; redirects are not followed
      res.on('end', () => resolve({ status: res.statusCode ?? null, ms: Date.now() - started }))
      res.on('error', () => resolve({ status: res.statusCode ?? null, ms: Date.now() - started }))
    })
    req.on('timeout', () => { req.destroy(new Error(`No response within ${timeoutMs / 1000} s`)) })
    req.on('error', e => resolve({ status: null, ms: Date.now() - started, error: e.message.slice(0, 200) }))
    req.end(body)
  })
}
