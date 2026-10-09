// Human-readable device from a User-Agent string (pure; unit-tested). Only for display in the sign-in history.
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device'
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : ''
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|python|node|axios|Go-http/i.test(ua) ? 'Script / API client' : ''
  return [br, os].filter(Boolean).join(' on ') || 'Unknown device'
}

/** The session id claim of a Supabase access token (not verified here; the database verifies the token itself). */
export function sessionIdFromJwt(token: string | null | undefined): string | null {
  try {
    const p = JSON.parse(Buffer.from((token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8'))
    return typeof p.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(p.session_id) ? p.session_id : null
  } catch { return null }
}
