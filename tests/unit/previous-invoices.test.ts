import { describe, expect, it } from 'vitest'
import { customerKey, detectColumns, readPreviousRow, TEMPLATE_CSV } from '@/lib/sales/previous-import'
import { previousProblems, previousSchema, previousTotals } from '@/lib/sales/previous'
import { parseCsv } from '@/lib/csv'

describe('previous invoices: amounts', () => {
  it('works from the total incl. VAT or from the amount before VAT', () => {
    expect(previousTotals(10500, 'total', 5)).toEqual({ subtotal: 10000, vat: 500, total: 10500 })
    expect(previousTotals(10000, 'net', 5)).toEqual({ subtotal: 10000, vat: 500, total: 10500 })
    expect(previousTotals(999.99, 'total', 0)).toEqual({ subtotal: 999.99, vat: 0, total: 999.99 })
  })
  it('refuses future dates, a due date before the invoice and paid above the total', () => {
    const v = (o: object) => previousSchema.parse({ customer_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', number: 'ASR-1', issue_date: '2026-01-10', amount: '1050', ...o })
    expect(previousProblems(v({}), '2026-11-23')).toBeNull()
    expect(previousProblems(v({ issue_date: '2026-12-01' }), '2026-11-23')).toMatch(/future/)
    expect(previousProblems(v({ due_date: '2026-01-01' }), '2026-11-23')).toMatch(/before the invoice date/)
    expect(previousProblems(v({ paid: '2000' }), '2026-11-23')).toMatch(/more than the invoice total/)
    expect(previousSchema.safeParse({ customer_id: 'x', number: '', issue_date: '2026-01-01', amount: '0' }).success).toBe(false)
  })
})

describe('previous invoices: Excel upload', () => {
  it('finds the columns of the template and of a typical Excel sheet', () => {
    const t = parseCsv(TEMPLATE_CSV)
    const cols = detectColumns(t[0])
    expect(Object.values(cols).every(i => i >= 0)).toBe(true)
    const own = detectColumns(['Inv No', 'Date', 'Client', 'Total', 'Received', 'Project'])
    expect(own).toMatchObject({ number: 0, issue_date: 1, customer: 2, amount: 3, paid: 4, description: 5, due_date: -1 })
  })
  it('reads a row (Excel dates and “AED 1,234” amounts) and explains a bad one', () => {
    const cols = detectColumns(['Customer', 'Invoice number', 'Invoice date', 'Due date', 'Amount incl. VAT', 'VAT %', 'Already paid'])
    expect(readPreviousRow(['GTSC', 'ASR-0153', '45366', '', 'AED 10,500', '5%', '1,000'], cols, 2)).toMatchObject({ customer: 'GTSC', number: 'ASR-0153', issue_date: '2024-03-15', amount: 10500, vat_rate: 5, paid: 1000 })
    expect(readPreviousRow(['GTSC', 'ASR-1', '31/12/2025', '', '500', '', ''], cols, 3)).toMatchObject({ issue_date: '2025-12-31', vat_rate: 5, paid: 0 })
    expect(readPreviousRow(['', 'X', '01/01/2025', '', '5', '', ''], cols, 4)).toEqual({ line: 4, error: 'Customer is empty' })
    expect((readPreviousRow(['A', 'X', 'yesterday', '', '5', '', ''], cols, 5) as any).error).toMatch(/Invoice date/)
    expect((readPreviousRow(['A', 'X', '01/01/2025', '', 'abc', '', ''], cols, 6) as any).error).toMatch(/Amount/)
    expect((readPreviousRow(['A', 'X', '01/01/2025', '', '100', '', '150'], cols, 7) as any).error).toMatch(/more than the amount/)
    expect((readPreviousRow(['A', 'X', '10/01/2025', '01/01/2025', '100', '', ''], cols, 8) as any).error).toMatch(/due date is before/)
  })
  it('matches customer names regardless of case, spaces and punctuation', () => {
    expect(customerKey('Gulf Technical Safety Training Centre-GTSC')).toBe(customerKey('gulf technical  safety training centre - gtsc'))
  })
})
