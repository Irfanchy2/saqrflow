import { describe, it, expect } from 'vitest'
import { buildTrend, greeting, pctChange } from '@/lib/dashboard-trend'

describe('dashboard trend', () => {
  it('12 calendar months ending this month, sales ex VAT, collections, expenses', () => {
    const t = buildTrend('2026-10-15', [{ issue_date: '2026-10-02', total: 1050, vat_amount: 50 }, { issue_date: '2025-11-30', total: 210, vat_amount: 10 }, { issue_date: '2025-10-31', total: 999, vat_amount: 0 }],
      [{ paid_on: '2026-09-10', amount: 500 }], [{ spent_on: '2026-10-01', amount: 120 }])
    expect(t.months.map(m => m.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(t.months[0].sales).toBe(200); expect(t.months[11]).toMatchObject({ sales: 1000, expenses: 120 }); expect(t.months[10].collected).toBe(500)
  })
  it('month to date compares with the same days of last month', () => {
    const t = buildTrend('2026-10-10', [{ issue_date: '2026-10-05', total: 1100, vat_amount: 100 }, { issue_date: '2026-09-08', total: 800, vat_amount: 0 }, { issue_date: '2026-09-25', total: 5000, vat_amount: 0 }], [])
    expect(t.mtd.sales).toBe(1000); expect(t.prevMtd.sales).toBe(800); expect(t.change.sales).toBe(25)
  })
  it('no comparison when last month had nothing (no fake +100%)', () => {
    expect(pctChange(500, 0)).toBeNull(); expect(pctChange(50, 200)).toBe(-75)
  })
  it('greeting follows the company time zone', () => {
    expect(greeting('Asia/Dubai', new Date('2026-10-15T04:00:00Z'))).toBe('Good morning')    // 08:00 Dubai
    expect(greeting('Asia/Dubai', new Date('2026-10-15T15:00:00Z'))).toBe('Good evening')    // 19:00 Dubai
  })
})
