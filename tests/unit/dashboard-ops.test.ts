import { describe, it, expect } from 'vitest'
import { onTimeRate, orderBook, salesFunnel, woProgress } from '@/lib/dashboard-ops'

describe('dashboard operations maths', () => {
  it('funnel: every lead counts in each step it reached; values add up; % of enquiries', () => {
    const f = salesFunnel([{ stage: 'new', estimated_value: 1000 }, { stage: 'site_visit_completed', estimated_value: 2000 }, { stage: 'quotation_sent', estimated_value: '3000' },
      { stage: 'negotiation', estimated_value: null }, { stage: 'won', estimated_value: 5000 }, { stage: 'lost', reached: 'quotation_sent', estimated_value: 400 }, { stage: 'on_hold' }])
    expect(f.map(s => s.count)).toEqual([7, 5, 4, 2, 1])
    expect(f[0].value).toBe(11400); expect(f[4].value).toBe(5000)
    expect(f.map(s => s.pct)).toEqual([100, 71, 57, 29, 14])
  })
  it('funnel with no leads is all zero, not NaN', () => {
    expect(salesFunnel([]).every(s => s.count === 0 && s.pct === 0)).toBe(true)
  })
  it('on time: completion day in the company time zone vs the target date', () => {
    const r = onTimeRate([
      { target_date: '2026-10-10', completed_at: '2026-10-10T19:30:00Z' },   // 23:30 in Dubai on the 10th: on time
      { target_date: '2026-10-10', completed_at: '2026-10-10T20:30:00Z' },   // 00:30 on the 11th: late
      { target_date: '2026-10-20', completed_at: '2026-10-01T08:00:00Z' },
      { target_date: null, completed_at: '2026-10-01T08:00:00Z' }, { target_date: '2026-10-01', completed_at: null },
    ])
    expect(r).toEqual({ pct: 67, onTime: 2, total: 3 })
    expect(onTimeRate([]).pct).toBeNull()
  })
  it('work order progress follows the shop-floor steps', () => {
    expect(woProgress('pending')).toBe(0); expect(woProgress('in_fabrication')).toBe(43); expect(woProgress('completed')).toBe(100); expect(woProgress('on_hold')).toBe(0)
  })
  it('order book: contract value left to invoice (ex VAT), never negative', () => {
    expect(orderBook([{ id: 'a', contract_value: 100000 }, { id: 'b', contract_value: 20000 }, { id: 'c', contract_value: null }],
      [{ project_id: 'a', total: 42000, vat_amount: 2000 }, { project_id: 'b', total: 25000, vat_amount: 0 }, { project_id: null, total: 999 }])).toEqual({ value: 60000, projects: 1 })
  })
})
