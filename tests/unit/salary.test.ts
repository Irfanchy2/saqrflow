import { describe, expect, it } from 'vitest'
import { cents, salaryStatus, splitOwed, statement, suggestedPay, sum, periodLabel, type Movement } from '@/lib/salary-math'
import { advanceBalance } from '@/lib/me'
import { employeeMayUse } from '@/lib/portal-paths'

const ob = (kind: string, period: string | null, remaining: number, entry_date = period ?? '2026-09-30') => ({ kind, period, entry_date, remaining })
const mv = (date: string, amount: number, kind = amount < 0 ? 'payment' : 'accrual', i = 0): Movement => ({ id: `${date}-${kind}-${i}`, date, kind, label: kind, amount, created_at: `${date}T10:00:0${i}Z` })

describe('salary arithmetic', () => {
  it('adds money in whole fils (no floating-point drift)', () => {
    expect(sum([0.1, 0.2])).toBe(0.3)
    expect(sum(['700.25', 299.75, '500'])).toBe(1500)
    expect(cents('1234.565')).toBe(123457)
  })
  it('splits what is owed into earlier months and the chosen month', () => {
    const obs = [ob('opening', null, 4500, '2026-10-01'), ob('accrual', '2026-10-01', 3000), ob('accrual', '2026-11-01', 3000), ob('adjustment', null, 250, '2026-11-12')]
    expect(splitOwed(obs, '2026-11')).toEqual({ previous: 7500, current: 3250 })
    expect(splitOwed(obs, '2026-10')).toEqual({ previous: 4500, current: 3000 })   // later months are not "earlier"
  })
  it('status: paid, partially paid, unpaid', () => {
    expect(salaryStatus(0, 0, false)).toBe('paid')
    expect(salaryStatus(-50, 0, false)).toBe('paid')
    expect(salaryStatus(7500, 3500, false)).toBe('partial')
    expect(salaryStatus(7500, 0, true)).toBe('partial')
    expect(salaryStatus(11000, 0, false)).toBe('unpaid')
  })
  it('Quick Pay suggests everything owed, or a month when nothing is owed', () => {
    expect(suggestedPay(10500, 3000)).toBe(10500)
    expect(suggestedPay(0, 3000)).toBe(3000)
    expect(suggestedPay(-200, null)).toBe(0)
  })
  it('labels periods for people', () => {
    expect(periodLabel({ kind: 'opening', period: null, entry_date: '2026-10-01' })).toBe('Opening balance')
    expect(periodLabel({ kind: 'accrual', period: '2026-11-01', entry_date: '2026-11-30' })).toBe('November 2026')
    expect(periodLabel({ kind: 'adjustment', period: '2026-10-01', entry_date: '2026-10-20', reason: 'Overtime' })).toBe('Overtime (October 2026)')
  })
})

describe('statement', () => {
  // the brief's scenarios A–D as statement lines
  const moves = [mv('2026-10-01', 8000, 'opening'), mv('2026-10-31', 3000, 'accrual'), mv('2026-10-15', -2000, 'payment', 1), mv('2026-10-15', -1500, 'payment', 2),
    mv('2026-11-30', 3000, 'accrual'), mv('2026-11-05', -1000, 'payment', 3)]
  it('carries the balance forward and runs it line by line', () => {
    const all = statement(moves, '2026-01-01', '2026-12-31')
    expect(all.brought).toBe(0)
    expect(all.rows.map(r => r.balance)).toEqual([8000, 6000, 4500, 7500, 6500, 9500])
    expect(all.closing).toBe(9500)
    expect(all.added).toBe(14000); expect(all.settled).toBe(4500)
  })
  it('a later period starts from the balance brought forward', () => {
    const nov = statement(moves, '2026-11-01', '2026-11-30')
    expect(nov.brought).toBe(7500)
    expect(nov.rows.map(r => r.amount)).toEqual([-1000, 3000])
    expect(nov.closing).toBe(9500)
  })
})

describe('advances and the portal', () => {
  it('counts what was recovered from salary when the balance view provides it', () => {
    const adv = [{ kind: 'advance', amount: 2000, settled: false, remaining: 1500 }, { kind: 'advance', amount: 600, settled: false }, { kind: 'deduction', amount: 300, settled: false }]
    expect(advanceBalance(4000, adv, 25)).toEqual({ outstanding: 2100, limit: 1000, available: 0 })
  })
  it('an employee may download their own salary statement', () => {
    expect(employeeMayUse('/api/salary-statements/0b6f1c1e-6d1a-4c55-9a0e-3c0f5e2b9a11')).toBe(true)
    expect(employeeMayUse('/salary')).toBe(false)
    expect(employeeMayUse('/salary/0b6f1c1e-6d1a-4c55-9a0e-3c0f5e2b9a11')).toBe(false)
  })
})
