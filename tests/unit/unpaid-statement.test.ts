import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { unpaidStatement } from '@/lib/sales/unpaid-statement'
import { renderStatementPdf } from '@/lib/sales/statement-pdf'
import { statementParams, statementQuery } from '@/lib/statement-params'
import type { Ledger } from '@/lib/ledger'

const inv = (number: string, issue: string, due: string | null, total: number, balance: number, daysOverdue = 0, lpo: string | null = null) =>
  ({ id: number, number, issue_date: issue, due_date: due, total, balance, status: balance > 0 ? 'sent' : 'paid', daysOverdue, lpo_ref: lpo, reference: null, projectId: null })
const ledger = (over: Partial<Ledger> = {}): Ledger => ({
  entries: [], opening: 0, closing: 0, totalDebit: 0, totalCredit: 0, overdue: 0,
  invoices: [inv('INV-3', '2026-10-20', '2026-11-19', 4200, 3200, 4, 'LPO-77'), inv('INV-1', '2026-07-01', '2026-07-31', 10500, 0), inv('INV-2', '2026-08-05', '2026-09-04', 2100, 2100, 80), inv('INV-4', '2026-11-10', '2026-12-10', 1050, 1050)],
  outstanding: 6350, ...over,
})

describe('statement of unpaid invoices', () => {
  it('lists only invoices with a balance, oldest first, with paid, balance and totals', () => {
    const u = unpaidStatement(ledger(), {}, '2026-11-23')
    expect(u.rows.map(r => r.number)).toEqual(['INV-2', 'INV-3', 'INV-4'])
    expect(u.rows.find(r => r.number === 'INV-3')).toMatchObject({ paid: 1000, balance: 3200, lpo_ref: 'LPO-77' })
    expect(u.totals).toEqual({ amount: 7350, paid: 1000, balance: 6350 })
    expect(u.ageing.map(a => a.amount)).toEqual([1050, 3200, 0, 2100, 0])
    expect(u.unapplied).toBeNull(); expect(u.netDue).toBe(6350)
  })
  it('shows money not tied to an invoice so the total due stays true', () => {
    const onAccount = unpaidStatement(ledger({ outstanding: 5350 }), {}, '2026-11-23')
    expect(onAccount.unapplied).toBe(-1000); expect(onAccount.netDue).toBe(5350)
    const opening = unpaidStatement(ledger({ outstanding: 8350 }), {}, '2026-11-23')
    expect(opening.unapplied).toBe(2000); expect(opening.netDue).toBe(8350)
  })
  it('a period limits the invoices by issue date (and drops the whole-account total)', () => {
    const u = unpaidStatement(ledger(), { from: '2026-10-01', to: '2026-10-31' }, '2026-11-23')
    expect(u.rows.map(r => r.number)).toEqual(['INV-3'])
    expect(u.netDue).toBeNull(); expect(u.unapplied).toBeNull()
  })
  it('nothing owed: an empty list', () => {
    expect(unpaidStatement(ledger({ invoices: [inv('INV-1', '2026-07-01', null, 100, 0)], outstanding: 0 }), {}, '2026-11-23').rows).toEqual([])
  })
  it('the statement type travels in the link', () => {
    expect(statementParams({ type: 'unpaid' }).type).toBe('unpaid')
    expect(statementParams({ type: 'other' }).type).toBe('full')
    expect(new URLSearchParams(statementQuery({ type: 'unpaid', from: '2026-01-01' })).toString()).toContain('type=unpaid'); expect(statementQuery({ type: 'unpaid', from: '2026-01-01' })).toContain('from=2026-01-01')
    expect(statementQuery({ type: 'full' })).toBe('')
  })
  it('the PDF carries the unpaid statement (and the full one stays as it was)', async () => {
    const cu = { name: 'Gulf Technical Safety Training Centre-GTSC', address: 'Abu Dhabi' }
    const opts = { companyName: 'Al Saqr', images: {}, showHeaderFooter: true, today: '2026-11-23' }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stmt-'))
    const txt = async (o: object) => { const f = path.join(dir, `${Math.random()}.pdf`); fs.writeFileSync(f, await renderStatementPdf(cu, ledger(), { ...opts, ...o })); return execFileSync('pdftotext', ['-layout', f, '-']).toString() }
    const u = await txt({ type: 'unpaid' })
    expect(u).toContain('STATEMENT OF UNPAID INVOICES')
    for (const n of ['INV-2', 'INV-3', 'INV-4', 'LPO-77', '6,350.00', 'Total due']) expect(u).toContain(n)
    expect(u).not.toMatch(/\bINV-1\b/)
    const full = await txt({})
    expect(full).toContain('STATEMENT OF ACCOUNT'); expect(full).not.toContain('UNPAID INVOICES')
  })
})
