/** Normalise a UAE-centric phone number to E.164; returns null when it cannot be made valid. */
export function toE164(raw: string, defaultCountry = '971'): string | null {
  let s = raw.replace(/[\s\-().]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  if (s.startsWith('+')) { /* already international */ }
  else if (s.startsWith('0')) s = '+' + defaultCountry + s.slice(1)
  else if (s.startsWith(defaultCountry)) s = '+' + s
  else return null
  return /^\+[1-9][0-9]{7,14}$/.test(s) ? s : null
}
