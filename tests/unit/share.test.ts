import { describe, expect, it } from 'vitest'
import { SHARE, SHARE_KINDS, fillShare, prettyPhone, shareBodyProblems, sharePerms, waChatLink } from '@/lib/whatsapp/share'
import { employeeMayUse } from '@/lib/portal-paths'
import { toE164 } from '@/lib/phone'

describe('free WhatsApp sharing messages', () => {
  it('has a default message for every document type, using only its own placeholders', () => {
    expect(SHARE_KINDS).toEqual(['payslip', 'salary_receipt', 'salary_statement', 'quotation', 'invoice', 'delivery_note', 'payment_reminder', 'customer_receipt', 'customer_statement', 'employee_document'])
    for (const k of SHARE_KINDS) expect(shareBodyProblems(k, SHARE[k].body)).toEqual([])
  })
  it('fills the payslip message without any salary amount', () => {
    const m = fillShare('payslip', SHARE.payslip.body, { employee: 'Ali Hassan', period: 'October 2026', company: 'Al Saqr' })
    expect(m).toBe('Dear Ali Hassan,\n\nPlease find your payslip for October 2026.\n\nCompany: Al Saqr\nSalary period: October 2026\n\nKindly review the attached document.\n\nThank you,\nAl Saqr')
    expect(m).not.toMatch(/AED|\d[\d,]*\.\d{2}/)
  })
  it('the receipt message shows the amount only because its template asks for {amount}', () => {
    const v = { employee: 'Ali Hassan', amount: 'AED 2,000.00', date: '29 Oct 2026', reference: 'TT-1', company: 'Al Saqr' }
    expect(fillShare('salary_receipt', SHARE.salary_receipt.body, v)).toContain('Your salary payment of AED 2,000.00 dated 29 Oct 2026 has been recorded.')
    expect(fillShare('salary_receipt', 'Dear {employee}, your receipt for {date} is attached. {company}', v)).not.toContain('2,000')
  })
  it('refuses placeholders a document does not have (no balances or other data leak into a message)', () => {
    expect(shareBodyProblems('payslip', 'Dear {employee}, you are owed {balance}. {company}')[0]).toMatch(/\{balance\} is not available/)
    expect(shareBodyProblems('payslip', 'Hi')).toContain('The message is too short.')
    expect(shareBodyProblems('invoice', 'x'.repeat(1001))).toContain('Keep the message under 1,000 characters.')
  })
  it('each document type is shared only with the access its data needs', () => {
    expect(sharePerms('payslip')).toEqual(['salary.view']); expect(sharePerms('salary_statement')).toEqual(['salary.view'])
    expect(sharePerms('customer_receipt')).toEqual(['finance.view']); expect(sharePerms('customer_statement')).toEqual(['finance.view'])
    expect(sharePerms('employee_document')).toEqual(['documents.view', 'employees.view_sensitive'])
    for (const k of SHARE_KINDS) expect(SHARE[k].party).toBe(['payslip', 'salary_receipt', 'salary_statement', 'employee_document'].includes(k) ? 'employee' : 'customer')
  })
  it('the salary statement and employee document messages carry no salary amounts', () => {
    const st = fillShare('salary_statement', SHARE.salary_statement.body, { employee: 'Ali Hassan', from: '1 Oct 2026', to: '29 Oct 2026', company: 'Al Saqr' })
    expect(st).toContain('salary statement from 1 Oct 2026 to 29 Oct 2026'); expect(st).not.toMatch(/AED|\d[\d,]*\.\d{2}/)
    expect(fillShare('customer_receipt', SHARE.customer_receipt.body, { customer: 'Gulf Horizon', amount: 'AED 2,500.00', date: '29 Oct 2026', reference: 'INV-1', company: 'Al Saqr' })).toContain('payment of AED 2,500.00 received on 29 Oct 2026 (INV-1)')
  })
  it('masks long digit runs in values (IDs, account numbers)', () => {
    expect(fillShare('payslip', 'Dear {employee} {company}', { employee: 'Ref 784199012345678', company: 'X' })).toContain('•••••••••••5678')
  })
})

describe('WhatsApp numbers', () => {
  it('normalises UAE and international numbers, refuses invalid ones', () => {
    expect(toE164('050 123 4567')).toBe('+971501234567')
    expect(toE164('00971501234567')).toBe('+971501234567')
    expect(toE164('+44 7911 123456')).toBe('+447911123456')
    expect(toE164('12345')).toBeNull()
    expect(toE164('abc')).toBeNull()
  })
  it('reads a number back in groups, and builds the chat link with the message', () => {
    expect(prettyPhone('+971501234567')).toBe('+971 50 123 4567')
    expect(waChatLink('+971501234567', 'Dear Ali,\nhello')).toBe('https://wa.me/971501234567?text=Dear%20Ali%2C%0Ahello')
  })
  it('an employee may download their own payslips in the portal, not the salary pages', () => {
    expect(employeeMayUse('/api/salary-payslips/0b6f1c1e-6d1a-4c55-9a0e-3c0f5e2b9a11')).toBe(true)
    expect(employeeMayUse('/api/salary-payslips/../salary')).toBe(false)
  })
})
