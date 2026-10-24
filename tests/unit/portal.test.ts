import { describe, expect, it } from 'vitest'
import { employeeMayUse } from '@/lib/portal-paths'
import { advanceBalance, attendanceSummary, workedHours } from '@/lib/me'

const ID = '0b6f1c1e-6d1a-4c55-9a0e-3c0f5e2b9a11'
describe('employee route allow-list (Employee Portal)', () => {
  it('lets an employee use only their portal and their own files', () => {
    for (const ok of ['/me', '/me/expenses', `/me/expenses/${ID}`, '/me/salary', '/api/expenses/scan', `/api/documents/${ID}/download`, `/api/payslips/${ID}`, `/api/notifications/${ID}/open`, `/api/employees/${ID}/photo`, '/auth/callback', '/offline'])
      expect(employeeMayUse(ok), ok).toBe(true)
  })
  it('sends every company page and API back to the portal', () => {
    for (const no of ['/', '/expenses', '/expenses?tab=claims', '/invoices', '/projects', '/employees', `/employees/${ID}`, '/settings', '/reports', '/users', '/approvals', '/documents', '/vault',
      '/api/export/expenses', '/api/expenses/export', `/api/documents/${ID}`, '/api/payslips/not-an-id', '/meeting', '/me-too', `/api/notifications/${ID}`, '/api/employees'])
      expect(employeeMayUse(no), no).toBe(false)
  })
})

describe('advance balance', () => {
  const adv = [{ kind: 'advance', amount: '500', settled: false }, { kind: 'advance', amount: 300, settled: true }, { kind: 'deduction', amount: 200, settled: false }]
  it('counts only advances not yet repaid', () => expect(advanceBalance(4000, adv, 0)).toEqual({ outstanding: 500, limit: 0, available: null }))
  it('available = limit (share of salary) less what is still owed, never negative', () => {
    expect(advanceBalance(4000, adv, 25)).toEqual({ outstanding: 500, limit: 1000, available: 500 })
    expect(advanceBalance(1000, adv, 25)).toEqual({ outstanding: 500, limit: 250, available: 0 })
    expect(advanceBalance(null, adv, 25).available).toBe(0)
  })
})

describe('attendance', () => {
  it('sums days by status and overtime', () => {
    expect(attendanceSummary([{ status: 'present', overtime_hours: '1.5' }, { status: 'present' }, { status: 'absent' }, { status: 'half_day', overtime_hours: 0 }, { status: 'leave' }]))
      .toEqual({ present: 2, absent: 1, half_day: 1, leave: 1, holiday: 0, overtime: 1.5 })
  })
  it('worked hours from check-in to check-out', () => {
    expect(workedHours('2026-10-20T04:00:00Z', '2026-10-20T12:30:00Z')).toBe(8.5)
    expect(workedHours('2026-10-20T04:00:00Z', null)).toBeNull()
  })
})
