import { describe, expect, it } from 'vitest'
import { KINDS, bodyProblems, fill, maskPhone, placeholders, safeFreeText, safeValue, toMetaBody } from '@/lib/whatsapp/messages'
import { messagePayload } from '@/lib/whatsapp/cloud'
import { parseWebhook } from '@/lib/whatsapp/webhook'

describe('WhatsApp message templates', () => {
  it('every default body is valid and uses only its own placeholders', () => {
    for (const [k, d] of Object.entries(KINDS)) { expect(bodyProblems(k, d.body), k).toEqual([]); expect(placeholders(k, d.body).every(v => d.vars.includes(v)), k).toBe(true) }
    expect(Object.keys(KINDS)).toEqual(['quotation', 'invoice', 'delivery_note', 'receipt', 'payslip', 'statement', 'payment_reminder', 'quotation_followup', 'document_expiry', 'cheque_reminder', 'project_update'])
  })
  it('converts {names} to Meta numbered variables in order of first use', () => {
    expect(toMetaBody('invoice', 'Hi {customer}, invoice {number} ({amount}) for {customer}. {company}')).toEqual({ text: 'Hi {{1}}, invoice {{2}} ({{3}}) for {{1}}. {{4}}', order: ['customer', 'number', 'amount', 'company'] })
  })
  it('rejects unknown placeholders and Meta formatting rules', () => {
    expect(bodyProblems('payslip', 'Dear {employee}, your salary {amount} is paid. {company}').join(' ')).toMatch(/\{amount\} is not available/)
    expect(bodyProblems('quotation', '{customer} here is your quotation {number}')).toEqual(expect.arrayContaining([expect.stringMatching(/start with a variable/), expect.stringMatching(/end with a variable/)]))
  })
  it('never writes ID, passport, IBAN or card numbers into a message', () => {
    expect(safeValue('Emirates ID 784199012345676')).toBe('Emirates ID •••••••••••5676')
    expect(safeValue('IBAN AE07 0331 2345 6789 0123 456')).toBe('IBAN IBAN ••••')
    expect(safeFreeText('EID 784-1990-1234567-6 and card 4111111111111111')).toBe('EID 784-••••-•••••••-• and card ••••••••••••1111')
    expect(fill('payslip', KINDS.payslip.body, { employee: 'Anil', period: 'September 2026', company: 'Al Saqr' })).not.toMatch(/\d{3,}\.\d{2}|AED/)
    expect(maskPhone('+971501234567')).toBe('+9715 ••• 567')
  })
})

describe('Cloud API payloads', () => {
  it('template with the PDF as document header and body parameters in order', () => {
    expect(messagePayload({ to: '+971501234567', kind: 'invoice', language: 'en', order: ['customer', 'number'], values: { customer: 'ABC', number: 'INV-610' }, doc: { id: 'media-1', filename: 'INV-610.pdf' } })).toEqual({
      messaging_product: 'whatsapp', to: '971501234567', type: 'template',
      template: { name: 'averiqo_invoice', language: { code: 'en' }, components: [
        { type: 'header', parameters: [{ type: 'document', document: { id: 'media-1', filename: 'INV-610.pdf' } }] },
        { type: 'body', parameters: [{ type: 'text', text: 'ABC' }, { type: 'text', text: 'INV-610' }] }] },
    })
  })
  it('inside the 24-hour window: the PDF with a custom caption, or plain text', () => {
    expect(messagePayload({ to: '+971501234567', kind: 'invoice', language: 'en', order: [], values: {}, doc: { id: 'm', filename: 'a.pdf' }, freeText: 'Here you go' }))
      .toEqual({ messaging_product: 'whatsapp', to: '971501234567', type: 'document', document: { id: 'm', filename: 'a.pdf', caption: 'Here you go' } })
    expect(messagePayload({ to: '+971501234567', kind: 'project_update', language: 'en', order: [], values: {}, freeText: 'Site starts Monday' }))
      .toEqual({ messaging_product: 'whatsapp', to: '971501234567', type: 'text', text: { body: 'Site starts Monday', preview_url: false } })
  })
  it('webhook: any inbound message opens the window for that number', () => {
    const r = parseWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '111' }, messages: [{ from: '971501234567', type: 'image', timestamp: '1760000000' }, { from: '971501234567', type: 'text', text: { body: 'STOP' }, timestamp: '1760000001' }] } }] }] })
    expect(r.inbound).toEqual([{ from: '+971501234567', phoneNumberId: '111', at: new Date(1760000000000).toISOString() }, { from: '+971501234567', phoneNumberId: '111', at: new Date(1760000001000).toISOString() }])
    expect(r.messages).toEqual([{ from: '+971501234567', text: 'STOP' }])
  })
})
