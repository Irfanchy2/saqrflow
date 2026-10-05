import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emiratesIdOk, luhnOk, mergeReadings, passportOk, trnOk, validateExtraction } from '@/lib/inbox/validate'
import { rulesExtract, type Extraction } from '@/lib/inbox/rules'
import { ocrImage } from '@/lib/inbox/ocr'

const x = (fields: Extraction['fields'], docType = 'emirates_id'): Extraction => ({ engine: 'rules', engineVersion: 't', docType, docTypeConfidence: 0.9, fields, alternatives: [] })
const F = (value: string, confidence = 0.9) => ({ value, confidence, source: 'label' as const })

describe('validators', () => {
  it('checks Emirates ID check digits, TRN and passport formats', () => {
    expect(luhnOk('79927398713')).toBe(true)
    expect(emiratesIdOk('784-1990-1234567-6')).toBe(true)
    expect(emiratesIdOk('784-1990-1234567-1')).toBe(false)
    expect(emiratesIdOk('785199012345676')).toBe(false)
    expect(trnOk('100 1234 5670 0003')).toBe(true)
    expect(trnOk('2001234567')).toBe(false)
    expect(passportOk('BX1234567')).toBe(true)
    expect(passportOk('B#12')).toBe(false)
  })
  it('lowers confidence and warns on misread values; raises it on valid ones', () => {
    const bad = x({ document_number: F('784-1990-1234567-1'), issue_date: F('2025-01-10'), expiry_date: F('2024-01-09'), date_of_birth: F('2030-01-01') })
    const w = validateExtraction(bad, '2026-10-05')
    expect(bad.fields.document_number!.confidence).toBeLessThanOrEqual(0.5)
    expect(bad.fields.expiry_date!.confidence).toBeLessThanOrEqual(0.4)
    expect(bad.fields.date_of_birth!.confidence).toBeLessThan(0.5)
    expect(w.join(' ')).toMatch(/check digit/); expect(w.join(' ')).toMatch(/before the issue date/); expect(w.join(' ')).toMatch(/Date of birth/)
    const good = x({ document_number: F('784199012345676', 0.85) })
    expect(validateExtraction(good, '2026-10-05')).toEqual([])
    expect(good.fields.document_number).toMatchObject({ value: '784-1990-1234567-6', confidence: 0.9 })
    const trn = x({ trn: F('TRN 100-123') }, 'tax_invoice')
    expect(validateExtraction(trn, '2026-10-05')[0]).toMatch(/15 digits/)
  })
})

describe('AI + local reading merge', () => {
  it('boosts agreement, flags disagreement for a person to decide', () => {
    const ai = { ...x({ document_number: F('784-1990-1234567-6', 0.9), expiry_date: F('2027-01-09', 0.9), holder_name: F('Mohammed Ayub', 0.8) }), engine: 'claude' as const }
    const local = x({ document_number: F('784199012345676', 0.8), expiry_date: F('2027-09-01', 0.8), nationality: F('Bangladesh', 0.9) })
    const { merged, warnings } = mergeReadings(ai, local)
    expect(merged.fields.document_number!.confidence).toBeCloseTo(0.95)
    expect(merged.fields.expiry_date).toMatchObject({ value: '2027-01-09', confidence: 0.6 })
    expect(merged.fields.nationality!.confidence).toBe(0.75)
    expect(merged.fields.holder_name!.value).toBe('Mohammed Ayub')
    expect(warnings).toHaveLength(1); expect(warnings[0]).toMatch(/expiry date/)
  })
  it('caps the type confidence when the two readers disagree on the document type', () => {
    const { merged, warnings } = mergeReadings({ ...x({}, 'passport'), engine: 'claude', docTypeConfidence: 0.95 }, { ...x({}, 'emirates_id'), docTypeConfidence: 0.9 })
    expect(merged.docTypeConfidence).toBe(0.65); expect(warnings[0]).toMatch(/confirm the type/)
  })
})

describe('local OCR (Tesseract, on this server)', () => {
  it('reads a photographed Emirates ID and the rules extract its fields', async () => {
    const png = new Uint8Array(readFileSync('tests/fixtures/emirates-id-photo.png'))
    const { text, confidence } = await ocrImage(png, 'image/png', 60_000)
    expect(confidence).toBeGreaterThan(0.6)
    const r = rulesExtract(text)
    expect(r.docType).toBe('emirates_id')
    expect(r.fields.expiry_date?.value).toBe('2027-01-09')
    expect(r.fields.document_number?.value.replace(/\D/g, '')).toBe('784199012345676')
    expect(validateExtraction(r, '2026-10-05')).toEqual([])
  }, 90_000)
  it('skips formats it cannot read', async () => {
    expect((await ocrImage(new Uint8Array([1, 2, 3]), 'application/pdf')).text).toBe('')
  })
})
