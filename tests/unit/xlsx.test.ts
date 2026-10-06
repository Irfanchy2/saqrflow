import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { readXlsx, writeXlsx } from '@/lib/xlsx'
import { parseCsv } from '@/lib/csv'

describe('xlsx round trip', () => {
  it('writes a real workbook and reads it back', () => {
    const b = writeXlsx('Customers', ['Name', 'Phone', 'Balance'], [['ABC Contracting & Co <LLC>', '+971 50 123 4567', 1250.5], ['شركة الصقر', '', 0], ['=HYPERLINK("x")', null, 3]])
    expect(Buffer.from(b.subarray(0, 2)).toString()).toBe('PK')
    const rows = readXlsx(b)
    expect(rows[0]).toEqual(['Name', 'Phone', 'Balance'])
    expect(rows[1]).toEqual(['ABC Contracting & Co <LLC>', '+971 50 123 4567', '1250.5'])
    expect(rows[2][0]).toBe('شركة الصقر')
    expect(rows[3][0]).toBe('=HYPERLINK("x")')           // stored as text, never as a formula
  })
  it('rejects garbage', () => { expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow() })
})
describe('csv parse', () => {
  it('quotes, commas, newlines, BOM', () => {
    expect(parseCsv('﻿name,phone\r\n"ABC, LLC","+971 ""x"""\n\nDEF,\n')).toEqual([['name', 'phone'], ['ABC, LLC', '+971 "x"'], ['DEF', '']])
    expect(parseCsv("name\n'=SUM(1)")).toEqual([['name'], ['=SUM(1)']])
  })
})
