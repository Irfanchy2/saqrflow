import { describe, expect, it } from 'vitest'
import { parseQuery } from '@/lib/ai/search'

const t = '2026-10-05'
describe('assistant: business questions without any AI service', () => {
  it('money owed and overdue invoices', () => {
    expect(parseQuery('Who owes us money?', t)).toMatchObject({ entity: 'receivables', expired: false })
    expect(parseQuery('Show outstanding payments for Gulf Builders', t)).toMatchObject({ entity: 'receivables', customer: 'Gulf Builders' })
    expect(parseQuery('Which customers have not paid?', t)).toMatchObject({ entity: 'receivables', customer: null })
    expect(parseQuery('Show overdue invoices', t)).toMatchObject({ entity: 'invoices', expired: true })
  })
  it('projects', () => {
    expect(parseQuery('Project status', t)).toMatchObject({ entity: 'projects', customer: null, expired: false })
    expect(parseQuery('Which projects are late?', t)).toMatchObject({ entity: 'projects', expired: true })
    expect(parseQuery('What is the status of Villa 9 project?', t)).toMatchObject({ entity: 'projects', customer: 'Villa 9' })
  })
  it('expiries, cheques, tickets, leads', () => {
    expect(parseQuery('What is expiring in the next 30 days?', t)).toMatchObject({ entity: 'expiries', expiring_within_days: 30 })
    expect(parseQuery('Which vehicles expire this month?', t)).toMatchObject({ entity: 'expiries', expiring_within_days: 26 })
    expect(parseQuery('Which cheques are due this week?', t)).toMatchObject({ entity: 'cheques', expiring_within_days: 7 })
    expect(parseQuery('Open service tickets', t)).toMatchObject({ entity: 'tickets' })
    expect(parseQuery('Show overdue tickets', t)).toMatchObject({ entity: 'tickets', expired: true })
    expect(parseQuery('Show the sales pipeline', t)).toMatchObject({ entity: 'leads' })
  })
  it('document questions keep working', () => {
    expect(parseQuery('Which documents expire within 60 days?', t)).toMatchObject({ entity: 'documents', expiring_within_days: 60 })
    expect(parseQuery('Show invoices for ABC Contracting.', t)).toMatchObject({ entity: 'invoices', customer: 'ABC Contracting' })
  })
})
