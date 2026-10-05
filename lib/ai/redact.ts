// Data minimisation before text leaves the server for an AI model: identity numbers are replaced with placeholders.
// The local rules read those numbers on our server (with check-digit validation), so nothing is lost.
const RULES: [RegExp, string][] = [
  [/^.*<{3,}.*$/gm, '[REDACTED-MRZ]'],                                                     // passport / ID machine-readable zone
  [/\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g, '[REDACTED-ID]'],                              // Emirates ID
  [/\bAE\d{2}\s?(?:\d{4}\s?){4}\d{3}\b/gi, '[REDACTED-IBAN]'],                              // UAE IBAN
  [/((?:passport|pass\.?)\s*(?:no|number|#)?\.?\s*[:#]?\s*)([A-Z]{1,2}\d{6,8})\b/gi, '$1[REDACTED-ID]'],
]
const LONG_NUMBER = /\b(?:\d[ -]?){13,19}\b/g                                                // card / account numbers (a TRN stays: it is public)
export function redactForAi(text: string): { text: string; redacted: boolean } {
  let out = text
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  out = out.replace(LONG_NUMBER, m => { const d = m.replace(/\D/g, ''); return d.length === 15 && d.startsWith('100') ? m : '[REDACTED-NUMBER]' })
  return { text: out, redacted: out !== text }
}
