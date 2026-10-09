import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { isDue, isoWeekday, latestOccurrence, describeSchedule } from '@/lib/report-periods'
import { guessMapping, parseAmount, parseDate, parseSource, parseVat, normHeader } from '@/lib/import-spec'
import { EVENTS, amountPasses, webhookBody, isEvent } from '@/lib/events'
import { deviceLabel, sessionIdFromJwt } from '@/lib/device'
import { isPrivateAddress, urlProblem } from '@/lib/net-guard'
import { signature, channelOk } from '@/lib/event-worker'
import { writeXlsxBook, readXlsx } from '@/lib/xlsx'

describe('scheduled report periods', () => {
  it('weekly: latest send day on/before today, previous 7 days', () => {
    expect(isoWeekday('2026-10-05')).toBe(1)   // Monday
    const o = latestOccurrence({ frequency: 'weekly', weekday: 1, month_day: null }, '2026-10-08')
    expect(o).toMatchObject({ key: 'W:2026-10-05', sendDate: '2026-10-05', from: '2026-09-28', to: '2026-10-04' })
    expect(latestOccurrence({ frequency: 'weekly', weekday: 4, month_day: null }, '2026-10-08').sendDate).toBe('2026-10-08')
  })
  it('monthly: previous calendar month; before the send day it is last month’s occurrence', () => {
    expect(latestOccurrence({ frequency: 'monthly', weekday: null, month_day: 3 }, '2026-10-09')).toMatchObject({ key: 'M:2026-10', from: '2026-09-01', to: '2026-09-30', label: 'September 2026' })
    expect(latestOccurrence({ frequency: 'monthly', weekday: null, month_day: 15 }, '2026-10-09')).toMatchObject({ key: 'M:2026-09', from: '2026-08-01', to: '2026-08-31' })
    expect(latestOccurrence({ frequency: 'monthly', weekday: null, month_day: 1 }, '2026-01-01')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
  })
  it('due once per occurrence, catches up a missed day, never when paused', () => {
    const s = { frequency: 'weekly' as const, weekday: 1, month_day: null, enabled: true, last_period: 'W:2026-09-28' }
    expect(isDue(s, '2026-10-06')).toBe(true)
    expect(isDue({ ...s, last_period: 'W:2026-10-05' }, '2026-10-06')).toBe(false)
    expect(isDue({ ...s, enabled: false }, '2026-10-06')).toBe(false)
    expect(describeSchedule({ frequency: 'monthly', weekday: null, month_day: 2 })).toBe('Monthly on the 2nd, for the previous month')
  })
})

describe('import wizard parsing', () => {
  it('guesses columns from common header names, each column once', () => {
    const m = guessMapping('customers', ['Customer Name', 'Mobile', 'E-mail', 'VAT No', 'Contact', 'Address'])
    expect(m).toMatchObject({ name: 0, phone: 1, email: 2, trn: 3, contact_person: 4, address: 5, whatsapp: -1 })
    const e = guessMapping('employees', ['Emp No', 'Employee Name', 'Date of Joining', 'Job Title'])
    expect(e).toMatchObject({ employee_no: 0, full_name: 1, joining_date: 2, designation: 3 })
    expect(normHeader('  VAT_No. ')).toBe('vat no')
  })
  it('dates, amounts, VAT and lead sources', () => {
    expect(parseDate('05/03/2024')).toBe('2024-03-05'); expect(parseDate('2024-03-05')).toBe('2024-03-05'); expect(parseDate('45000')).toBe('2023-03-15')
    expect(parseDate('')).toBeNull(); expect(parseDate('31/13/2024')).toBe('bad'); expect(parseDate('March')).toBe('bad')
    expect(parseAmount('AED 12,500.50')).toBe(12500.5); expect(parseAmount('')).toBeNull(); expect(parseAmount('abc')).toBeNaN()
    expect(parseVat('5%')).toBe('standard'); expect(parseVat('Zero rated')).toBe('zero'); expect(parseVat('Exempt')).toBe('exempt'); expect(parseVat('weird')).toBeNull()
    expect(parseSource('Walk-in')).toBe('walk_in'); expect(parseSource('Website form')).toBe('website'); expect(parseSource('Google')).toBe('google'); expect(parseSource('?')).toBe('other')
  })
})

describe('events, rules and webhooks', () => {
  it('rule minimum amount', () => {
    expect(amountPasses(null, {})).toBe(true)
    expect(amountPasses(50000, { amount: 52500 })).toBe(true)
    expect(amountPasses(50000, { amount: '49999.99' })).toBe(false)
    expect(amountPasses(1, {})).toBe(false)
  })
  it('webhook body shape and link', () => {
    const b = webhookBody({ id: 7, event: 'quotation.accepted', entity_id: 'abc', created_at: '2026-10-09T08:00:00Z', data: { number: 'AS-1', amount: 10 } }, 'https://x.test')
    expect(b).toEqual({ id: 'evt_7', type: 'quotation.accepted', created_at: '2026-10-09T08:00:00Z', data: { id: 'abc', number: 'AS-1', amount: 10, url: 'https://x.test/invoices/abc' } })
    expect(EVENTS['quotation.accepted'].title({ number: 'AS-1', party: 'ACME', amount: 52500 })).toBe('Quotation AS-1 accepted · ACME · AED 52,500.00')
    expect(isEvent('invoice.paid')).toBe(true); expect(isEvent('drop.table')).toBe(false)
  })
  it('signature = HMAC-SHA256 of "<t>.<body>"', () => {
    const sig = signature('whsec_test', 1700000000, '{"a":1}')
    expect(sig).toBe(`t=1700000000,v1=${createHmac('sha256', 'whsec_test').update('1700000000.{"a":1}').digest('hex')}`)
  })
  it('channels need what the recipient can receive', () => {
    const r = { id: 'r', user_id: 'u', email: null, whatsapp_number: '+971500000000', whatsapp_opt_in: 'pending', is_active: true }
    expect(channelOk('in_app', r)).toBe(true); expect(channelOk('email', r)).toBe(false); expect(channelOk('whatsapp', r)).toBe(false)
    expect(channelOk('whatsapp', { ...r, whatsapp_opt_in: 'opted_in' })).toBe(true); expect(channelOk('in_app', { ...r, is_active: false })).toBe(false)
  })
})

describe('outbound URL guard (SSRF)', () => {
  it('private, loopback, link-local, CGNAT and metadata addresses are refused', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true)
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false)
  })
  it('URL rules', () => {
    expect(urlProblem('https://hooks.example.com/x')).toBeNull()
    expect(urlProblem('http://hooks.example.com/x')).toMatch(/https/)
    expect(urlProblem('https://user:pw@example.com/')).toMatch(/password/)
    expect(urlProblem('https://localhost/x')).toMatch(/public/)
    expect(urlProblem('https://10.1.2.3/x')).toMatch(/public/)
    expect(urlProblem('not a url')).toMatch(/full URL/)
  })
})

describe('devices and sessions', () => {
  it('device labels', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge on Windows')
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')).toBe('Chrome on Android')
    expect(deviceLabel(null)).toBe('Unknown device')
  })
  it('session id from an access token', () => {
    const sid = '0b9f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
    const tok = `x.${Buffer.from(JSON.stringify({ sub: 'u', session_id: sid })).toString('base64url')}.y`
    expect(sessionIdFromJwt(tok)).toBe(sid)
    expect(sessionIdFromJwt('garbage')).toBeNull(); expect(sessionIdFromJwt(`x.${Buffer.from('{"session_id":"nope"}').toString('base64url')}.y`)).toBeNull()
  })
})

describe('full backup workbook', () => {
  it('several sheets, unique safe names, first sheet readable', () => {
    const buf = writeXlsxBook([{ name: 'Customers', headers: ['name'], rows: [['ACME']] }, { name: 'Customers', headers: ['n'], rows: [] }, { name: 'A/B:C', headers: ['x'], rows: [[1]] }])
    expect(readXlsx(buf)).toEqual([['name'], ['ACME']])
    const txt = Buffer.from(buf).toString('latin1')
    expect(txt).toContain('xl/worksheets/sheet3.xml')
  })
})
