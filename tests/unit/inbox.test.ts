import { describe, it, expect, beforeAll } from 'vitest'
import { makePdf } from '../fixtures/make-pdf.mjs'
import { SAMPLES } from '../fixtures/samples.mjs'
import { extractText } from '@/lib/inbox/text'
import { classify, parseDate, rulesExtract, type Extraction } from '@/lib/inbox/rules'
import { matchEmployee, nameScore, companyScore, matchByName, type EmployeeCandidate } from '@/lib/inbox/match'
import { decide } from '@/lib/inbox/decide'
import { DOC_TYPES } from '@/lib/inbox/catalog'

const read: Record<string, { text: string; x: Extraction }> = {}
beforeAll(async () => {
  for (const [n, lines] of Object.entries(SAMPLES)) { const text = await extractText(makePdf(lines), 'application/pdf'); read[n] = { text, x: rulesExtract(text) } }
})

describe('PDF text extraction + classification of the 12 sample documents', () => {
  const expected: Record<string, string> = {
    'trade-license.pdf': 'trade_license', 'emirates-id-mohammed.pdf': 'emirates_id', 'emirates-id-rahim.pdf': 'emirates_id', 'visa-mohammed.pdf': 'residence_visa',
    'visa-rahim.pdf': 'residence_visa', 'tenancy-contract.pdf': 'tenancy_contract', 'insurance.pdf': 'company_insurance', 'invoice-abc.pdf': 'tax_invoice',
    'delivery-note-abc.pdf': 'delivery_note', 'vehicle-registration.pdf': 'vehicle_registration', 'renewed-trade-license.pdf': 'trade_license', 'unknown-letter.pdf': 'unknown',
  }
  for (const [file, type] of Object.entries(expected)) it(`${file} → ${type}`, () => {
    expect(read[file].text.length).toBeGreaterThan(10)
    expect(read[file].x.docType).toBe(type)
    if (type !== 'unknown') expect(read[file].x.docTypeConfidence).toBeGreaterThanOrEqual(0.8)
  })
  it('extracts the key fields with high confidence', () => {
    const f = (n: string) => read[n].x.fields
    expect(f('trade-license.pdf')).toMatchObject({ document_number: { value: '789456' }, issue_date: { value: '2026-05-13' }, expiry_date: { value: '2027-05-12' }, company_name: { value: 'AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC' }, issuing_authority: { value: 'Dubai Economy and Tourism (DET)' } })
    expect(f('emirates-id-mohammed.pdf')).toMatchObject({ document_number: { value: '784-1990-1234567-1' }, holder_name: { value: 'Mohammed Ayub' }, nationality: { value: 'Bangladesh' }, expiry_date: { value: '2027-01-09' }, date_of_birth: { value: '1990-02-14' } })
    expect(f('visa-mohammed.pdf')).toMatchObject({ holder_name: { value: 'MOHAMMED AYUB' }, profession: { value: 'Welder' }, expiry_date: { value: '2027-02-14' }, issuing_authority: { value: 'GDRFA' } })
    expect(f('tenancy-contract.pdf')).toMatchObject({ document_number: { value: 'TC-2026-0457' }, landlord: { value: 'Gulf Properties LLC' }, expiry_date: { value: '2027-03-31' }, amount: { value: '85000' } })
    expect(f('invoice-abc.pdf')).toMatchObject({ document_number: { value: 'INV-301' }, customer_name: { value: 'ABC Contracting LLC' }, amount: { value: '26250' }, trn: { value: '100123456700003' } })
    expect(f('vehicle-registration.pdf')).toMatchObject({ plate_number: { value: 'Dubai K 45821' }, expiry_date: { value: '2027-06-04' } })
    for (const k of ['expiry_date', 'document_number'] as const) expect(f('trade-license.pdf')[k]!.confidence).toBeGreaterThanOrEqual(0.85)
  })
  it('never invents values: an unrelated letter yields no fields', () => {
    expect(read['unknown-letter.pdf'].x.fields).toEqual({})
  })
  it('date of birth is never used as expiry or issue date', () => {
    const f = read['emirates-id-mohammed.pdf'].x.fields
    expect(f.expiry_date!.value).not.toBe(f.date_of_birth!.value); expect(f.issue_date!.value).not.toBe(f.date_of_birth!.value)
  })
  it('images / scans without a text layer return no text (→ manual review or AI OCR)', async () => {
    expect(await extractText(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe('')
    expect(await extractText(new Uint8Array([1, 2, 3]), 'application/pdf')).toBe('')
  })
  it('every catalogue type has a category and destination path', () => {
    for (const d of DOC_TYPES) { expect(d.category.length).toBeGreaterThan(2); expect(d.path.length).toBeGreaterThan(1) }
  })
})

describe('date parsing (UAE day-first)', () => {
  it.each([['05/03/2027', '2027-03-05'], ['5-3-2027', '2027-03-05'], ['2027-03-05', '2027-03-05'], ['05 Mar 2027', '2027-03-05'], ['5-March-2027', '2027-03-05'], ['March 5, 2027', '2027-03-05'], ['31.12.2026', '2026-12-31']])('%s → %s', (a, b) => expect(parseDate(a)).toBe(b))
  it('rejects impossible dates', () => { expect(parseDate('31/02/2027')).toBeNull(); expect(parseDate('13/13/2027')).toBeNull() })
  it('Arabic and mixed-language labels are recognised', () => {
    expect(classify('رخصة تجارية رقم الرخصة 12345').docType).toBe('trade_license')
    expect(rulesExtract('Emirates ID\nتاريخ الانتهاء 01/02/2028').fields.expiry_date?.value).toBe('2028-02-01')
  })
  it('passport MRZ is parsed', () => {
    const x = rulesExtract('REPUBLIC OF INDIA PASSPORT\nP<INDKHAN<<MOHAMMED<AYUB<<<<<<<<<<<<<<<<<<<<<<<\nZ1234567<4IND9002141M3001095<<<<<<<<<<<<<<04')
    expect(x.docType).toBe('passport')
    expect(x.fields).toMatchObject({ holder_name: { value: 'Mohammed Ayub Khan', source: 'mrz' }, document_number: { value: 'Z1234567' }, date_of_birth: { value: '1990-02-14' }, expiry_date: { value: '2030-01-09' } })
  })
})

describe('employee matching engine', () => {
  const emps: EmployeeCandidate[] = [
    { id: 'e1', full_name: 'Mohammed Ayub', employee_no: 'E-001', idNumbers: [] },
    { id: 'e2', full_name: 'Rahim Uddin', employee_no: 'E-002', idNumbers: ['784-1988-7654321-2'] },
    { id: 'e3', full_name: 'Mohammed Rafiq', employee_no: 'E-003', idNumbers: [] },
  ]
  it('exact name → 97%', () => expect(matchEmployee({ holderName: 'MOHAMMED AYUB', text: '' }, emps)[0]).toMatchObject({ id: 'e1', confidence: 0.97 }))
  it('aliases (Mohd / Muhammad) and extra surname still match', () => {
    expect(matchEmployee({ holderName: 'Mohd Ayub Khan', text: '' }, emps)[0]).toMatchObject({ id: 'e1', confidence: 0.9 })
    expect(nameScore('Muhammad Ayub', 'Mohammed Ayub')).toBe(0.97)
  })
  it('an ID number already on file beats the name', () => {
    const m = matchEmployee({ holderName: 'R. Uddin', documentNumber: '784198876543212', text: '' }, emps)
    expect(m[0]).toMatchObject({ id: 'e2', confidence: 0.99 })
  })
  it('a shared first name alone is not a confident match', () => {
    const m = matchEmployee({ holderName: 'Mohammed', text: '' }, emps)
    expect(m.every(x => x.confidence < 0.85)).toBe(true)
  })
  it('unknown person → no candidates (never creates employees)', () => expect(matchEmployee({ holderName: 'John Smith', text: '' }, emps)).toEqual([]))
  it('company name matching', () => {
    expect(companyScore('AL SAQR STEELS L.L.C', ['Al Saqr Steels'])).toBe(0.99)
    expect(companyScore('Totally Different Trading LLC', ['Al Saqr Steels'])).toBeLessThan(0.5)
    expect(companyScore('AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC', ['Al Saqr Steels'])).toBeGreaterThanOrEqual(0.75)   // shares the distinctive “Saqr”
    expect(matchByName('ABC Contracting L.L.C.', [{ id: 'c1', name: 'ABC Contracting LLC' }, { id: 'c2', name: 'XYZ Builders' }])[0]).toMatchObject({ id: 'c1' })
  })
})

describe('routing decision (AI must not silently save uncertain information)', () => {
  const base = { companyName: 'Al Saqr Steels', companyMatch: 0.9, employees: [], customers: [], duplicates: [], hasText: true }
  it('confident company document → ready (still requires confirmation)', () => {
    const d = decide(read['trade-license.pdf'].x, base)
    expect(d.status).toBe('ready'); expect(d.suggestion.path).toEqual(['Company', 'Al Saqr Steels', 'Company Documents', 'Trade License'])
  })
  it('employee document without a confident match → needs review', () => {
    const d = decide(read['visa-mohammed.pdf'].x, base)
    expect(d.status).toBe('needs_review'); expect(d.reasons.join()).toMatch(/No matching employee/)
  })
  it('two similar employees → needs review even if both score well', () => {
    const d = decide(read['visa-mohammed.pdf'].x, { ...base, employees: [{ id: 'a', name: 'A', confidence: 0.9, reason: '' }, { id: 'b', name: 'B', confidence: 0.86, reason: '' }] })
    expect(d.status).toBe('needs_review')
  })
  it('confident employee match → ready with destination', () => {
    const d = decide(read['visa-mohammed.pdf'].x, { ...base, employees: [{ id: 'e1', name: 'Mohammed Ayub', confidence: 0.97, reason: '' }] })
    expect(d.status).toBe('ready'); expect(d.suggestion.path).toEqual(['Employees', 'Mohammed Ayub', 'Documents', 'Visa'])
  })
  it('unknown document → manual review', () => expect(decide(read['unknown-letter.pdf'].x, base)).toMatchObject({ status: 'needs_review', reasons: ['Document type not recognised'] }))
  it('scanned image with local rules → manual review with an explanation', () => {
    const d = decide({ engine: 'rules', engineVersion: 'x', docType: 'unknown', docTypeConfidence: 0, fields: {}, alternatives: [] }, { ...base, hasText: false })
    expect(d.reasons[0]).toMatch(/No readable text/)
  })
  it('exact same file → duplicate; same number → review; newer expiry → renewal suggestion', () => {
    expect(decide(read['trade-license.pdf'].x, { ...base, duplicates: [{ documentId: 'd', name: 'TL', kind: 'same_file', expiry: null, ownerId: null }] }).status).toBe('duplicate')
    expect(decide(read['trade-license.pdf'].x, { ...base, duplicates: [{ documentId: 'd', name: 'TL', kind: 'same_number', expiry: '2027-05-12', ownerId: null }] }).reasons).toContain('Possible duplicate detected')
    expect(decide(read['renewed-trade-license.pdf'].x, { ...base, duplicates: [{ documentId: 'd', name: 'TL', kind: 'renewal', expiry: '2027-05-12', ownerId: null }] }).status).toBe('ready')
  })
  it('company name on the document that does not match raises a warning', () => {
    expect(decide(read['trade-license.pdf'].x, { ...base, companyMatch: 0.2 }).suggestion.warnings[0]).toMatch(/differs/)
  })
  it('invoice for an unknown customer → review; known customer → ready', () => {
    expect(decide(read['invoice-abc.pdf'].x, base).status).toBe('needs_review')
    expect(decide(read['invoice-abc.pdf'].x, { ...base, customers: [{ id: 'c1', name: 'ABC Contracting LLC', confidence: 0.99, reason: '' }] }).status).toBe('ready')
  })
})
