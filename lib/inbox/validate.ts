// Sanity checks on extracted values (pure, unit-tested). A failed check never blocks — it lowers confidence
// and adds a warning so a person looks at the field before filing.
import type { Extraction, Field, Fields } from './rules'

const digits = (s: string) => s.replace(/\D/g, '')

/** Luhn (mod 10) check — used by the 15-digit Emirates ID number (784-YYYY-NNNNNNN-C). */
export function luhnOk(num: string): boolean {
  const d = digits(num); if (d.length < 2) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i])
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  return sum % 10 === 0
}
export function emiratesIdOk(v: string): boolean { const d = digits(v); return d.length === 15 && d.startsWith('784') && luhnOk(d) }
export function trnOk(v: string): boolean { const d = digits(v); return d.length === 15 && d.startsWith('100') }
export function passportOk(v: string): boolean { return /^[A-Z0-9]{6,9}$/i.test(v.replace(/\s/g, '')) }

const lower = (f: Field | undefined, max: number) => { if (f) f.confidence = Math.min(f.confidence, max) }
const raise = (f: Field | undefined, by = 0.05) => { if (f) f.confidence = Math.min(0.99, f.confidence + by) }
const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5)

/** Validates fields in place; returns human warnings. `today` is the company-local ISO date. */
export function validateExtraction(x: Extraction, today: string): string[] {
  const f = x.fields, w: string[] = []
  const no = f.document_number
  if (no) {
    if (x.docType === 'emirates_id' || (/^784/.test(digits(no.value)) && digits(no.value).length === 15)) {
      if (emiratesIdOk(no.value)) { raise(no); no.value = digits(no.value).replace(/^(\d{3})(\d{4})(\d{7})(\d)$/, '$1-$2-$3-$4') }
      else { lower(no, 0.5); w.push('Emirates ID number fails its check digit — compare it with the card (a digit may be misread).') }
    } else if (x.docType === 'passport' && !passportOk(no.value)) { lower(no, 0.55); w.push('Passport number has an unusual format — please check it.') }
  }
  if (f.trn) {
    if (trnOk(f.trn.value)) { raise(f.trn); f.trn.value = digits(f.trn.value) }
    else { lower(f.trn, 0.5); w.push('TRN should be 15 digits starting with 100 — please check it.') }
  }
  const iss = f.issue_date?.value, exp = f.expiry_date?.value, dob = f.date_of_birth?.value
  if (iss && exp && exp < iss) { lower(f.expiry_date, 0.4); lower(f.issue_date, 0.6); w.push('Expiry date is before the issue date — day and month may be swapped.') }
  if (iss && iss > today) { lower(f.issue_date, 0.5); w.push('Issue date is in the future — please check it.') }
  if (iss && exp && yearsBetween(iss, exp) > 11) { lower(f.expiry_date, 0.6); w.push('Validity longer than 10 years is unusual — check the expiry date.') }
  if (dob) {
    const age = yearsBetween(dob, today)
    if (age < 14 || age > 90) { lower(f.date_of_birth, 0.45); w.push('Date of birth looks wrong (age out of range).') }
    if (iss && dob > iss) { lower(f.date_of_birth, 0.4); w.push('Date of birth is after the issue date.') }
  }
  if (f.amount && !(Number(f.amount.value.replace(/,/g, '')) > 0)) { lower(f.amount, 0.4); w.push('Amount is not a valid positive number.') }
  return w
}

/**
 * Combine the AI reading with the local (rules/OCR) reading.
 * Agreement raises confidence; disagreement caps it at 0.6 and warns, so a person decides.
 */
export function mergeReadings(ai: Extraction, local: Extraction): { merged: Extraction; warnings: string[] } {
  const norm = (k: string, v: string) => (/date/.test(k) ? v : k === 'document_number' || k === 'trn' ? digits(v) || v.replace(/\W/g, '').toUpperCase() : v.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const fields: Fields = {}, w: string[] = []
  const keys = new Set([...Object.keys(ai.fields), ...Object.keys(local.fields)]) as Set<keyof Fields>
  for (const k of keys) {
    const a = ai.fields[k], l = local.fields[k]
    if (a && l) {
      if (norm(k, a.value) === norm(k, l.value)) fields[k] = { ...a, confidence: Math.min(0.99, Math.max(a.confidence, l.confidence) + 0.05) }
      else { fields[k] = { ...a, confidence: Math.min(a.confidence, 0.6) }; w.push(`AI and text reading disagree on ${String(k).replace(/_/g, ' ')} (“${a.value}” vs “${l.value}”) — please confirm.`) }
    } else if (a) fields[k] = a
    else if (l) fields[k] = { ...l, confidence: Math.min(l.confidence, 0.75) }
  }
  let docTypeConfidence = ai.docTypeConfidence
  if (ai.docType === 'unknown' && local.docType !== 'unknown' && local.docTypeConfidence >= 0.8) {
    w.push(`AI could not identify the document; text rules suggest ${local.docType.replace(/_/g, ' ')} — please confirm the type.`)
    return { merged: { ...ai, docType: local.docType, docTypeConfidence: Math.min(local.docTypeConfidence, 0.75), fields, alternatives: local.alternatives }, warnings: w }
  }
  if (local.docType === ai.docType && local.docTypeConfidence >= 0.5) docTypeConfidence = Math.min(0.99, docTypeConfidence + 0.05)
  else if (local.docTypeConfidence >= 0.8 && local.docType !== ai.docType) { docTypeConfidence = Math.min(docTypeConfidence, 0.65); w.push(`AI read this as ${ai.docType.replace(/_/g, ' ')}, the text rules as ${local.docType.replace(/_/g, ' ')} — please confirm the type.`) }
  return { merged: { ...ai, fields, docTypeConfidence, alternatives: local.alternatives }, warnings: w }
}
